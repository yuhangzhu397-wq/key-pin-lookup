export const MIN_KEY_PREFIX_LENGTH = 4;
export const KEY_PATTERN = /^(?:pk-|key-)[a-zA-Z0-9_-]{4,500}$/;

export function isSupportedKey(value) {
  return typeof value === 'string' && KEY_PATTERN.test(value);
}

export function columnForKey(value) {
  return value.toLowerCase().startsWith('key-') ? 'api_key_id' : 'api_key';
}

export function toSqlLikePrefix(value) {
  const escaped = value
    .replaceAll('=', '==')
    .replaceAll('%', '=%')
    .replaceAll('_', '=_');

  return `${escaped}%`;
}
