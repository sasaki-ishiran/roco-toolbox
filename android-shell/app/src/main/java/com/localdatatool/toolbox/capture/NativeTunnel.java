package com.localdatatool.toolbox.capture;

/** In-process, no-root packet forwarding. All callbacks run on the run() thread. */
public final class NativeTunnel {
    static {
        System.loadLibrary("zdtun");
        System.loadLibrary("collector_tunnel");
    }

    private NativeTunnel() {}

    public interface Callback {
        /**
         * Called after native cancellation registration, before any forwarding.
         * Return false if this capture was already stopped before run() started.
         * The service must set its cancellation flag BEFORE calling stop().
         */
        boolean onReady();

        /** Must call VpnService.protect(fd); returning false stops capture. */
        boolean protectSocket(int fd);

        /** Packet starts at its IPv4/IPv6 header. Copy is owned by the callback. */
        void onPacket(byte[] packet, boolean outgoing);

        /** Fatal capture error, delivered once after native sockets are released. */
        void onNativeError(String message);
    }

    /**
     * Blocks until stop() or a fatal error. Configure the VPN MTU as 1500.
     * Returns an empty string on normal stop (including onReady() == false),
     * otherwise an error description.
     * The caller owns fd and must keep it open until this method returns.
     * Packet callbacks should enqueue work quickly and must not block on network IO.
     */
    public static native String run(int fd, Callback callback);

    /** Requests cancellation; select/writable waits check it every 200 ms. */
    public static native void stop();
}
