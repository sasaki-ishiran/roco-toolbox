const SPECIALITY_BY_ID = Object.freeze({
  1: "无",
  101: "奇袭",
  103: "亲密",
  104: "灵巧",
  401: "疾行",
  402: "同乘",
  502: "无畏",
  1001: "爱分享",
  3001: "家里蹲",
  5002: "热心教",
  50001: "慈悲为怀"
});

function decodeSpeciality(value) {
  const specialityId = Number(value) || 0;
  const recognized = Object.prototype.hasOwnProperty.call(SPECIALITY_BY_ID, specialityId);
  const specialityText = recognized ? SPECIALITY_BY_ID[specialityId] : "";
  return {
    specialityId: specialityId || null,
    realSpecialityIds: specialityId > 1 ? [specialityId] : [],
    specialityText,
    hasSpeciality: specialityId > 1,
    specialityRecognized: recognized
  };
}

module.exports = { SPECIALITY_BY_ID, decodeSpeciality };
