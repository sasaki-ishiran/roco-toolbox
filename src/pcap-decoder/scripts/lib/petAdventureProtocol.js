const { GULU_BALL_BY_CONF_ID } = require("../../miniprogram/utils/guluBallProtocol");
const { getPetAdventureLocationName } = require("../../miniprogram/utils/petAdventureLocations");

const HATCH_ACQUISITION_TYPE_ID = 1;
const CAPTURE_ACQUISITION_TYPE_ID = 2;
const EGG_SOURCE_ID_MIN = 22000000;
const EGG_SOURCE_ID_MAX_EXCLUSIVE = 24000000;

function firstInt(raw, field) {
  const value = raw && raw.int_fields && raw.int_fields[String(field)] && raw.int_fields[String(field)][0];
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function optionalInt(raw, field) {
  const values = raw && raw.int_fields && raw.int_fields[String(field)];
  if (!Array.isArray(values) || !values.length) return null;
  const value = Number(values[0]);
  return Number.isFinite(value) ? value : null;
}

function readVarint(bytes, offset) {
  let value = 0;
  let shift = 0;
  for (let index = offset; index < bytes.length && shift < 53; index += 1, shift += 7) {
    value += (bytes[index] & 0x7f) * (2 ** shift);
    if (!(bytes[index] & 0x80)) return { value, next: index + 1 };
  }
  return null;
}

function parseMessage(bytes) {
  const fields = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    if (!tag) break;
    offset = tag.next;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    let value;
    if (wire === 0) {
      const parsed = readVarint(bytes, offset);
      if (!parsed) break;
      value = parsed.value;
      offset = parsed.next;
    } else if (wire === 2) {
      const length = readVarint(bytes, offset);
      if (!length) break;
      offset = length.next;
      value = bytes.subarray(offset, offset + length.value);
      offset += length.value;
    } else if (wire === 1) {
      value = bytes.subarray(offset, offset + 8);
      offset += 8;
    } else if (wire === 5) {
      value = bytes.subarray(offset, offset + 4);
      offset += 4;
    } else {
      break;
    }
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  return fields;
}

function hexToBytes(hex) {
  const text = String(hex || "");
  const bytes = new Uint8Array(Math.floor(text.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function isoDate(unix) {
  return unix > 0 ? new Date(unix * 1000).toISOString() : "";
}

function isEggSourceId(value) {
  const sourceId = Number(value || 0);
  return sourceId >= EGG_SOURCE_ID_MIN && sourceId < EGG_SOURCE_ID_MAX_EXCLUSIVE;
}

function decodeEvolutionEvents(raw, resolvePetName) {
  const values = raw && raw.byte_fields && raw.byte_fields["70"];
  if (!Array.isArray(values)) return [];
  return values.flatMap((hex) => {
    const top = parseMessage(hexToBytes(hex));
    return (top.get(1) || []).flatMap((eventBytes) => {
      if (!(eventBytes instanceof Uint8Array)) return [];
      const event = parseMessage(eventBytes);
      const occurredAtUnix = Number(event.get(1) && event.get(1)[0] || 0);
      const fromPetId = Number(event.get(2) && event.get(2)[0] || 0);
      const toPetId = Number(event.get(3) && event.get(3)[0] || 0);
      if (!(occurredAtUnix > 0) || !(fromPetId > 0) || !(toPetId > 0)) return [];
      return [{
        occurredAtUnix,
        occurredAt: isoDate(occurredAtUnix),
        fromPetId,
        fromPetName: typeof resolvePetName === "function" ? resolvePetName(fromPetId) : "",
        toPetId,
        toPetName: typeof resolvePetName === "function" ? resolvePetName(toPetId) : ""
      }];
    });
  });
}

function decodePetAdventure(raw, options = {}) {
  const acquisitionSourceId = optionalInt(raw, 4);
  const acquisitionProtocolVariantId = optionalInt(raw, 5);
  const acquisitionBallConfId = firstInt(raw, 11);
  const acquisitionLevel = firstInt(raw, 41);
  const acquisitionLocationId = firstInt(raw, 58);
  const acquisitionMethodDetailId = firstInt(raw, 73);
  const obtainedAtUnix = firstInt(raw, 32);
  const hatched = acquisitionProtocolVariantId === HATCH_ACQUISITION_TYPE_ID || isEggSourceId(acquisitionSourceId);
  const acquisitionTypeId = hatched ? HATCH_ACQUISITION_TYPE_ID : CAPTURE_ACQUISITION_TYPE_ID;
  const acquisitionType = hatched ? "孵化" : "捕捉";
  const evolutionEvents = decodeEvolutionEvents(raw, options.resolvePetName);
  const adventureExperience = {
    acquisitionTypeId: acquisitionTypeId || null,
    acquisitionType,
    acquisitionSourceId,
    acquisitionProtocolVariantId,
    ballConfId: acquisitionBallConfId || null,
    ballName: GULU_BALL_BY_CONF_ID[acquisitionBallConfId] || "",
    level: acquisitionLevel || null,
    locationId: acquisitionLocationId || null,
    locationName: getPetAdventureLocationName(acquisitionLocationId),
    acquisitionMethodDetailId: acquisitionMethodDetailId || null,
    obtainedAtUnix: obtainedAtUnix || null,
    obtainedAt: isoDate(obtainedAtUnix),
    evolutionEvents
  };
  return {
    acquisitionTypeId: adventureExperience.acquisitionTypeId,
    acquisitionType,
    acquisitionSourceId: adventureExperience.acquisitionSourceId,
    acquisitionProtocolVariantId: adventureExperience.acquisitionProtocolVariantId,
    acquisitionBallConfId: adventureExperience.ballConfId,
    acquisitionBallName: adventureExperience.ballName,
    acquisitionLevel: adventureExperience.level,
    acquisitionLocationId: adventureExperience.locationId,
    acquisitionLocationName: adventureExperience.locationName,
    acquisitionMethodDetailId: adventureExperience.acquisitionMethodDetailId,
    adventureExperience,
    evolutionEvents
  };
}

module.exports = {
  CAPTURE_ACQUISITION_TYPE_ID,
  HATCH_ACQUISITION_TYPE_ID,
  decodePetAdventure,
  decodeEvolutionEvents,
  isEggSourceId
};
