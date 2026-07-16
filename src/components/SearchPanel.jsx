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
          placeholder="输入 pk-... 或 key-... 的前几位"
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
        支持前缀查询；pk- 或 key- 后至少输入 4 位，匹配多条时请继续补充字符
      </p>
    </form>
  );
}
