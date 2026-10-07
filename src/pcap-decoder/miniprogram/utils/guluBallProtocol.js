const GULU_BALL_BY_CONF_ID = Object.freeze({
  100002: "普通咕噜球",
  100003: "高级咕噜球",
  100255: "国王球",
  100262: "美妙球",
  100263: "好战球",
  100271: "光合球",
  100272: "网兜球",
  100273: "暗星球",
  100274: "调温球",
  100275: "绝缘球",
  100283: "淘沙球",
  100284: "变幻球",
  100285: "捕光球",
  100286: "棱镜球",
  100290: "奇趣球",
  100288: "织梦棱镜球",
  100289: "狂欢棱镜球",
  100291: "铅绘棱镜球",
  100292: "月涌棱镜球",
  100982: "童话球",
  100983: "失重球",
  280001: "柔软咕噜球"
});

function decodeGuluBallEntry(fields) {
  const itemInstanceId = Number(fields && fields.get(1) && fields.get(1)[0] || 0);
  const itemConfId = Number(fields && fields.get(2) && fields.get(2)[0] || 0);
  const quantity = Number(fields && fields.get(3) && fields.get(3)[0] || 0);
  const updatedAtUnix = Number(fields && fields.get(4) && fields.get(4)[0] || 0);
  if (!(itemConfId > 0) || !Number.isFinite(quantity) || quantity < 0) return null;
  return {
    itemInstanceId: itemInstanceId || null,
    itemConfId,
    quantity,
    updatedAtUnix: updatedAtUnix > 0 ? updatedAtUnix : null,
    updatedAt: updatedAtUnix > 0 ? new Date(updatedAtUnix * 1000).toISOString() : "",
    name: GULU_BALL_BY_CONF_ID[itemConfId] || "",
    recognized: Boolean(GULU_BALL_BY_CONF_ID[itemConfId])
  };
}

module.exports = { GULU_BALL_BY_CONF_ID, decodeGuluBallEntry };
