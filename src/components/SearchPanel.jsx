import { EyeIcon } from '../icons.jsx';

export default function SearchPanel({
  value,
  visible,
  loading,
  onChange,
  onToggleVisibility,
  onSubmit,
}) {
  return (
    <form className="search-panel" onSubmit={onSubmit} noValidate>
      <label className="field-label" htmlFor="key-input">
        API Key / Key ID
      </label>
      <div className="input-wrap">
        <input
          id="key-input"
          name="key"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder="粘贴 pk-... 或 key-..."
          autoComplete="off"
          autoCapitalize="none"
          spellCheck="false"
          maxLength={512}
          aria-describedby="key-helper"
        />
        <button
          className="visibility-button"
          type="button"
          onClick={onToggleVisibility}
          aria-label={visible ? '隐藏 Key' : '显示 Key'}
        >
          <EyeIcon crossed={visible} />
        </button>
      </div>
      <button className="primary-button" type="submit" disabled={!value.trim() || loading}>
        {loading ? '查询中…' : '查询'}
      </button>
      <p id="key-helper" className="field-helper">
        支持 pk- 开头的 API Key 和 key- 开头的 Key ID
      </p>
    </form>
  );
}
