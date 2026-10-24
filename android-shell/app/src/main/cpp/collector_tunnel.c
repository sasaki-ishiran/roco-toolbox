#include <jni.h>
#include <stdbool.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>

#include "zdtun.h"

#define POLL_TIMEOUT_US 200000
#define MAX_PACKET_SIZE 65535
#define TUN_MTU 1500

static pthread_mutex_t lifecycle_lock = PTHREAD_MUTEX_INITIALIZER;
static atomic_bool running = ATOMIC_VAR_INIT(false);
static atomic_bool stop_requested = ATOMIC_VAR_INIT(false);

typedef struct {
    JNIEnv *env;
    jobject callback;
    jmethodID ready_method;
    jmethodID protect_method;
    jmethodID packet_method;
    jmethodID error_method;
    int tun_fd;
    bool cleaning_up;
    char error[256];
} capture_context;

static void fail(capture_context *ctx, const char *format, ...) {
    if (ctx->error[0]) return;
    va_list args;
    va_start(args, format);
    vsnprintf(ctx->error, sizeof(ctx->error), format, args);
    va_end(args);
}

static bool canceled(const capture_context *ctx) {
    return ctx->cleaning_up || ctx->error[0] ||
           atomic_load_explicit(&stop_requested, memory_order_acquire);
}

static bool java_exception(capture_context *ctx, const char *operation) {
    if (!(*ctx->env)->ExceptionCheck(ctx->env)) return false;
    // Never make more JNI calls with a pending exception. Report a bounded error
    // after cleanup instead of letting a callback strand native network sockets.
    (*ctx->env)->ExceptionClear(ctx->env);
    fail(ctx, "Java callback failed: %s", operation);
    return true;
}

static int emit_packet(capture_context *ctx, const char *data, int length,
                       bool outgoing) {
    if (canceled(ctx)) return -1;
    jbyteArray bytes = (*ctx->env)->NewByteArray(ctx->env, length);
    if (java_exception(ctx, "allocate packet") || !bytes) {
        fail(ctx, "Unable to allocate packet callback buffer");
        return -1;
    }
    (*ctx->env)->SetByteArrayRegion(ctx->env, bytes, 0, length, (const jbyte *)data);
    if (!java_exception(ctx, "copy packet")) {
        (*ctx->env)->CallVoidMethod(ctx->env, ctx->callback, ctx->packet_method,
                                   bytes, outgoing ? JNI_TRUE : JNI_FALSE);
        java_exception(ctx, "onPacket");
    }
    (*ctx->env)->DeleteLocalRef(ctx->env, bytes);
    return canceled(ctx) ? -1 : 0;
}

static int prepare_socket(zdtun_t *tun, socket_t fd) {
    capture_context *ctx = zdtun_userdata(tun);
    if (canceled(ctx)) return -1;
    jboolean protected_socket = (*ctx->env)->CallBooleanMethod(
        ctx->env, ctx->callback, ctx->protect_method, (jint)fd);
    if (java_exception(ctx, "protectSocket")) return -1;
    if (protected_socket != JNI_TRUE) {
        fail(ctx, "VpnService.protect failed for socket %d", fd);
        return -1;
    }
    // zdtun TCP sockets are already nonblocking. Apply this to UDP/ICMP too so
    // socket send operations cannot indefinitely delay stop().
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) {
        fail(ctx, "Unable to configure forwarding socket: %s", strerror(errno));
        return -1;
    }
    return 0;
}

static int send_to_tun(zdtun_t *tun, zdtun_pkt_t *packet,
                       const zdtun_conn_t *connection) {
    (void)connection;
    capture_context *ctx = zdtun_userdata(tun);
    struct timespec started;
    clock_gettime(CLOCK_MONOTONIC, &started);
    while (!canceled(ctx)) {
        ssize_t written = write(ctx->tun_fd, packet->buf, packet->len);
        if (written == packet->len) {
            return emit_packet(ctx, packet->buf, packet->len, false);
        }
        if (written >= 0) {
            fail(ctx, "Partial TUN packet write: %zd/%u", written, packet->len);
            return -1;
        }
        if (errno == EINTR) continue;
        if (errno != EAGAIN && errno != EWOULDBLOCK && errno != ENOBUFS) {
            if (!atomic_load_explicit(&stop_requested, memory_order_acquire))
                fail(ctx, "TUN write failed: %s", strerror(errno));
            return -1;
        }
        struct timespec now;
        clock_gettime(CLOCK_MONOTONIC, &now);
        if (now.tv_sec - started.tv_sec >= 5) {
            fail(ctx, "TUN write timed out after 5 seconds");
            return -1;
        }
        fd_set writable;
        FD_ZERO(&writable);
        FD_SET(ctx->tun_fd, &writable);
        struct timeval timeout = { .tv_sec = 0, .tv_usec = POLL_TIMEOUT_US };
        int ready = select(ctx->tun_fd + 1, NULL, &writable, NULL, &timeout);
        if (ready < 0 && errno != EINTR) {
            if (!atomic_load_explicit(&stop_requested, memory_order_acquire))
                fail(ctx, "TUN writable wait failed: %s", strerror(errno));
            return -1;
        }
    }
    return -1;
}

static void capture_loop(capture_context *ctx, zdtun_t *tun) {
    char packet[MAX_PACKET_SIZE];
    struct timespec last_purge;
    clock_gettime(CLOCK_MONOTONIC, &last_purge);

    while (!canceled(ctx)) {
        fd_set readable;
        fd_set writable;
        int max_fd = 0;
        zdtun_fds(tun, &max_fd, &readable, &writable);
        FD_SET(ctx->tun_fd, &readable);
        if (ctx->tun_fd > max_fd) max_fd = ctx->tun_fd;
        struct timeval timeout = { .tv_sec = 0, .tv_usec = POLL_TIMEOUT_US };
        int ready = select(max_fd + 1, &readable, &writable, NULL, &timeout);
        if (canceled(ctx)) break;
        if (ready < 0) {
            if (errno == EINTR) continue;
            fail(ctx, "Capture select failed: %s", strerror(errno));
            break;
        }

        if (ready > 0) {
            bool tun_readable = FD_ISSET(ctx->tun_fd, &readable);
            FD_CLR(ctx->tun_fd, &readable);
            // Always process BOTH upstream sockets and the TUN in the same
            // iteration. An if/else here starves incoming packets during upload.
            // A peer failure is connection-local; zdtun closes that connection.
            zdtun_handle_fd(tun, &readable, &writable);
            if (tun_readable && !canceled(ctx)) {
                ssize_t length = read(ctx->tun_fd, packet, sizeof(packet));
                if (length > 0) {
                    if (emit_packet(ctx, packet, (int)length, true) == 0)
                        zdtun_easy_forward(tun, packet, (int)length);
                } else if (length == 0) {
                    fail(ctx, "TUN interface reached end of stream");
                } else if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
                    fail(ctx, "TUN read failed: %s", strerror(errno));
                }
            }
        }
        struct timespec now;
        clock_gettime(CLOCK_MONOTONIC, &now);
        if (now.tv_sec - last_purge.tv_sec >= 1) {
            zdtun_purge_expired(tun);
            last_purge = now;
        }
    }
}

JNIEXPORT jstring JNICALL
Java_com_localdatatool_toolbox_capture_NativeTunnel_run(JNIEnv *env, jclass type,
                                         jint fd, jobject callback) {
    (void)type;
    pthread_mutex_lock(&lifecycle_lock);
    if (atomic_load_explicit(&running, memory_order_acquire)) {
        pthread_mutex_unlock(&lifecycle_lock);
        return (*env)->NewStringUTF(env, "A native capture is already running");
    }
    atomic_store_explicit(&stop_requested, false, memory_order_release);
    atomic_store_explicit(&running, true, memory_order_release);
    pthread_mutex_unlock(&lifecycle_lock);

    capture_context ctx = { .env = env, .callback = callback, .tun_fd = fd };
    zdtun_t *tun = NULL;
    int original_flags = -1;
    if (!callback) {
        fail(&ctx, "Native capture callback is missing");
        goto cleanup;
    }
    jclass callback_class = (*env)->GetObjectClass(env, callback);
    if (java_exception(&ctx, "resolve callback class") || !callback_class)
        goto cleanup;
    ctx.ready_method = (*env)->GetMethodID(env, callback_class, "onReady", "()Z");
    if (!java_exception(&ctx, "resolve onReady"))
        ctx.protect_method = (*env)->GetMethodID(env, callback_class, "protectSocket", "(I)Z");
    if (!java_exception(&ctx, "resolve protectSocket"))
        ctx.packet_method = (*env)->GetMethodID(env, callback_class, "onPacket", "([BZ)V");
    if (!java_exception(&ctx, "resolve onPacket"))
        ctx.error_method = (*env)->GetMethodID(env, callback_class, "onNativeError", "(Ljava/lang/String;)V");
    java_exception(&ctx, "resolve onNativeError");
    (*env)->DeleteLocalRef(env, callback_class);
    if (!ctx.ready_method || !ctx.protect_method || !ctx.packet_method || !ctx.error_method || ctx.error[0]) {
        fail(&ctx, "Native capture callback does not implement the required methods");
        goto cleanup;
    }
    // Native stop() now sees this run. If stop occurred before registration,
    // the service's cancellation flag is observed by onReady instead. Setting
    // that flag before stop() closes both sides of the startup race.
    if (canceled(&ctx)) goto cleanup;
    jboolean ready = (*env)->CallBooleanMethod(env, callback, ctx.ready_method);
    if (java_exception(&ctx, "onReady") || ready != JNI_TRUE || canceled(&ctx))
        goto cleanup;
    if (fd < 0 || fd >= FD_SETSIZE) {
        fail(&ctx, "Invalid TUN descriptor %d (select limit %d)", fd, FD_SETSIZE);
        goto cleanup;
    }
    original_flags = fcntl(fd, F_GETFL, 0);
    if (original_flags < 0 || fcntl(fd, F_SETFL, original_flags | O_NONBLOCK) < 0) {
        fail(&ctx, "Unable to configure TUN descriptor: %s", strerror(errno));
        goto cleanup;
    }

    zdtun_callbacks_t callbacks = {
        .prepare_socket = prepare_socket,
        .send_client = send_to_tun,
    };
    tun = zdtun_init(&callbacks, &ctx);
    if (!tun) {
        fail(&ctx, "Unable to initialize zdtun");
        goto cleanup;
    }
    zdtun_set_mtu(tun, TUN_MTU);
    capture_loop(&ctx, tun);

cleanup:
    ctx.cleaning_up = true;
    if (tun) zdtun_finalize(tun);
    // fd remains owned by Java. Restore its flags, never close or duplicate it.
    if (original_flags >= 0 && fcntl(fd, F_SETFL, original_flags) < 0)
        fail(&ctx, "Unable to restore TUN descriptor flags: %s", strerror(errno));
    if (ctx.error[0] && ctx.error_method) {
        jstring message = (*env)->NewStringUTF(env, ctx.error);
        if (!java_exception(&ctx, "allocate error message") && message) {
            (*env)->CallVoidMethod(env, callback, ctx.error_method, message);
            java_exception(&ctx, "onNativeError");
            (*env)->DeleteLocalRef(env, message);
        }
    }
    pthread_mutex_lock(&lifecycle_lock);
    atomic_store_explicit(&running, false, memory_order_release);
    pthread_mutex_unlock(&lifecycle_lock);
    return (*env)->NewStringUTF(env, ctx.error);
}

JNIEXPORT void JNICALL
Java_com_localdatatool_toolbox_capture_NativeTunnel_stop(JNIEnv *env, jclass type) {
    (void)env;
    (void)type;
    pthread_mutex_lock(&lifecycle_lock);
    if (atomic_load_explicit(&running, memory_order_acquire))
        atomic_store_explicit(&stop_requested, true, memory_order_release);
    pthread_mutex_unlock(&lifecycle_lock);
}
