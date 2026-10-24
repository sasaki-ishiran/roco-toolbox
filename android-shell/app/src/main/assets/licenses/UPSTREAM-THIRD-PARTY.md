# Native capture components

## Native local parser in 1.2.4

This version uses the Android Java parser and javax.crypto AES. No Python runtime, standard library, Chaquopy, or downloaded executable code is included. Named protocol fields and resource allowlists follow the desktop collector; size/medal catalogue data is encoded as compact offline data in NativePetCatalog.java.

The complete corresponding application, Java, JNI and modified zdtun source is published at https://danking.cn/releases/android-collector-1.2.4-source.zip. License texts, this source URL and this notice remain embedded. The source ZIP is offered alongside the APK at no charge. The source ZIP excludes build outputs, local captures, signing material and credentials injected at build time.

## zdtun

- Upstream: https://github.com/emanuele-f/zdtun
- Pinned commit: `80b7941d4e685d8354346820878eaec0e35b6b1e`
- Source snapshot: https://github.com/emanuele-f/zdtun/tree/80b7941d4e685d8354346820878eaec0e35b6b1e
- Retrieved: 2026-09-08
- Author: Emanuele Faranda, with copyright years retained in each upstream file.
- License: GNU Lesser General Public License, version 3 or later.
- Local source: `app/src/main/cpp/third_party/zdtun/`.
- Complete LGPL text: `app/src/main/cpp/third_party/zdtun/COPYING`.
- Complete underlying GPL text: `app/src/main/cpp/third_party/zdtun/COPYING.GPL`
  (from https://www.gnu.org/licenses/gpl-3.0.txt).

The native build generates a separate `libzdtun.so` and links
`libcollector_tunnel.so` dynamically against it. The complete corresponding
modified zdtun source, application JNI source, Java source, and build configuration
are supplied in this project so the application can be rebuilt with a modified
library. Distribute these files and the license notices with APK releases; do not
offer only a binary or remove the ability to rebuild and install a modified APK.
No proprietary signing key is required to make a new installable build: a recipient
can build and sign their own APK using their own key.

The signed 1.2.3 APK also carries the complete corresponding source archive at
`assets/licenses/source-1.2.3.zip`. Unzip the APK to obtain it. The archive omits
itself, build outputs, private credentials and signing material; these are not
needed to rebuild the app with a recipient's own key.

Local zdtun changes made for this collector on 2026-09-08:

1. Add the optional `prepare_socket` callback to `zdtun_callbacks_t`; reject and
   close a new socket before connecting or sending if Android `VpnService.protect`
   fails. The original `on_socket_open` callback remains available. This changes
   the native callback-struct ABI, so use the included header when rebuilding.
2. Add `MSG_NOSIGNAL` to socket sends when supported, including SOCKS5 sends,
   instead of installing a process-wide SIGPIPE handler.
3. Service both readable and writable readiness for the same socket in
   `zdtun_handle_fd`, checking that the read did not close it first.
4. Dispatch ICMPv6 socket reads to the existing ICMP reply handler.

The original upstream `CMakeLists.txt` is retained for reference. The Android app
uses the parent `app/src/main/cpp/CMakeLists.txt`, which builds shared libraries
and requests 16 KB ELF segment alignment. The added JNI bridge is application
integration code and is not copied from PCAPdroid.

### Bundled upstream headers

`third_party/uthash.h` retains Troy D. Hanson's permissive BSD-style license in its
header. `third_party/net_headers.h` contains upstream packet-header definitions.
These files are delivered unchanged from the pinned zdtun snapshot.

## Architecture references

- PCAPdroid: https://github.com/emanuele-f/PCAPdroid
- PCAPdroid application API:
  https://github.com/emanuele-f/PCAPdroid/blob/master/docs/app_api.md

PCAPdroid was researched as an architectural reference. Its external control API
requires its separate app to be installed; this collector embeds zdtun directly
and does not invoke that API or bundle PCAPdroid code. It performs local TCP/IP
forwarding and PCAP capture without root, remote relay, or a second capture app.

## JNI lifecycle and build

- Java must create a TUN with MTU 1500 and retain its descriptor until
  `NativeTunnel.run(fd, callback)` returns.
- Run is blocking; invoke it on a dedicated worker. It calls `onPacket` and
  `protectSocket` synchronously on that worker. Queue expensive parsing or network
  uploads elsewhere.
- The service sets a volatile cancellation flag before calling `stop()` and
  clears it only when preparing a new capture. `Callback.onReady()` runs after
  native cancellation registration and returns false if that flag is already
  set. This makes a stop requested before the worker enters native code effective.
- `stop()` requests cancellation. Socket/TUN waits inspect it at intervals of no
  more than 200 ms. A Java callback that blocks can delay shutdown.
- Native code temporarily enables nonblocking TUN IO and restores the original
  flags before returning. It never closes Java's TUN descriptor.
- Normal cancellation returns an empty string. Fatal errors return a description
  and invoke `onNativeError` after zdtun releases its sockets. Errors from individual
  remote peers are handled as connection errors and do not stop the whole capture.
- No process-wide signal dispositions are changed.
- NDK 28.2.13676358 and CMake 3.22.1 can build these sources using the Android NDK
  toolchain. ABI outputs are standard Android `.so` files.

Native compilation verifies source/build compatibility. Real-device validation
must additionally check VPN consent, per-app routing, DNS, concurrent TCP upload
and download, UDP replies, PCAP readability, and start/stop cycles.

## 2026-09-27: reconnect TCP sockets predating VPN startup

The bundled zdtun `zdtun_easy_forward()` now responds to untracked non-SYN TCP
segments with a correctly sequenced IPv4/IPv6 reset, allowing the app to reconnect
instead of silently dropping its old-route traffic. Received RST, fragments,
and malformed packets remain ignored. Existing tracked flows and normal SYN
connection creation retain their original path. The reset uses a temporary
closed descriptor and allocates no upstream socket or connection-table entry.
The native regression source and Windows runner are in `tests/native/`.
