export const MIN_SHORT_KEY_LENGTH = 7;
export const KEY_PATTERN = /^(?:pk-[a-zA-Z0-9_-]{4,509}|key-[a-zA-Z0-9_-]{3,508})$/;

export function isSupportedKey(value) {
  return typeof value === 'string'
    && value.length >= MIN_SHORT_KEY_LENGTH
    && value.length <= 512
    && KEY_PATTERN.test(value);
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
