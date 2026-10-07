// The snapshot detectors only ask for the FIRST occurrence of a field in a
// loose protobuf suffix. Materialising every suffix produces quadratic memory.
// Share wire nodes + memoise first-field links instead, bounded per plaintext.
export function createFirstFieldProbe(bytes, readVarint, end = bytes.length) {
  const nodes = new Map();
  const fields = new Map();
  const MAX_ENTRIES = 65536;
  function nodeAt(start) {
    if (nodes.has(start)) return nodes.get(start);
    const tag = readVarint(bytes, start, end);
    let node = null;
    if (tag && tag.number && tag.next <= end) {
      const wire = tag.number % 8;
      const field = Math.floor(tag.number / 8);
      let offset = tag.next;
      if (wire === 0) {
        const value = readVarint(bytes, offset, end);
        if (value && value.next <= end) node = { field, next: value.next, value: value.number === null ? value.value.toString() : value.number };
      } else {
        let length = wire === 1 ? 8 : wire === 5 ? 4 : -1;
        if (wire === 2) {
          const value = readVarint(bytes, offset, end);
          if (value && value.number !== null && value.number >= 0) { length = value.number; offset = value.next; }
        }
        if (length >= 0 && offset + length <= end) node = { field, start: offset, next: offset + length };
      }
    }
    if (nodes.size >= MAX_ENTRIES) nodes.clear();
    nodes.set(start, node);
    return node;
  }
  function first(start, field) {
    if (!fields.has(field)) fields.set(field, new Map());
    const cache = fields.get(field);
    const visited = [];
    let cursor = start;
    let target = -1;
    while (cursor < end) {
      if (cache.has(cursor)) { target = cache.get(cursor); break; }
      const node = nodeAt(cursor);
      if (!node) break;
      if (node.field === field) { target = cursor; break; }
      if (visited.length < MAX_ENTRIES) visited.push(cursor);
      cursor = node.next;
    }
    if (cache.size + visited.length + 1 > MAX_ENTRIES) cache.clear();
    cache.set(start, target);
    for (const offset of visited) cache.set(offset, target);
    const node = target >= 0 ? nodeAt(target) : null;
    if (!node) return undefined;
    return [node.start === undefined ? node.value : bytes.subarray(node.start, node.next)];
  }
  return (start) => ({
    get size() { return nodeAt(start) ? 1 : 0; },
    get(field) { return first(start, field); }
  });
}
