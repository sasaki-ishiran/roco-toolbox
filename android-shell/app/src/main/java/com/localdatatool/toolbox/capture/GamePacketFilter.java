package com.localdatatool.toolbox.capture;

final class GamePacketFilter {
    static final int GAME_PORT = 8195;

    private GamePacketFilter() {}

    static boolean shouldRecord(byte[] packet) {
        if (packet == null || packet.length == 0) return false;
        int version = (packet[0] & 0xff) >>> 4;
        if (version == 4) return ipv4TcpPort(packet);
        if (version == 6) return ipv6TcpPort(packet);
        return false;
    }

    private static boolean ipv4TcpPort(byte[] packet) {
        if (packet.length < 24 || (packet[9] & 0xff) != 6) return false;
        int headerLength = (packet[0] & 0x0f) * 4;
        return headerLength >= 20 && packet.length >= headerLength + 4 && matchingPort(packet, headerLength);
    }

    private static boolean ipv6TcpPort(byte[] packet) {
        return packet.length >= 44 && (packet[6] & 0xff) == 6 && matchingPort(packet, 40);
    }

    private static boolean matchingPort(byte[] packet, int offset) {
        int source = ((packet[offset] & 0xff) << 8) | (packet[offset + 1] & 0xff);
        int destination = ((packet[offset + 2] & 0xff) << 8) | (packet[offset + 3] & 0xff);
        return source == GAME_PORT || destination == GAME_PORT;
    }
}
