import { Eye, EyeSlash, Info, MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react';

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
      <div className="lookup-column-heading">
        <span className="lookup-heading-icon"><MagnifyingGlass size={19} weight="bold" /></span>
        <div>
          <h2>查询条件</h2>
          <p>输入一种凭证标识即可定位归属关系</p>
        </div>
      </div>
      <label className="field-label" htmlFor="key-input">Key / Key ID</label>
      <div className="input-wrap">
        <input
          id="key-input"
          name="key"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder="Key ID、完整 Key 或前 7 位"
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
          {visible ? <EyeSlash size={21} /> : <Eye size={21} />}
        </button>
      </div>
      <button className="primary-button" type="submit" disabled={!value.trim() || loading}>
        {loading ? '查询中…' : '查询'}
      </button>
      <section className="lookup-format-guide" aria-labelledby="format-guide-title">
        <h3 id="format-guide-title">支持的查询格式</h3>
        <dl>
          <div><dt>完整 API Key</dt><dd>pk-xxxxxxxxxxxxxxxx</dd></div>
          <div><dt>前 7 位（含前缀）</dt><dd>pk-abcd</dd></div>
          <div><dt>Key ID</dt><dd>key-xxxxxxxx</dd></div>
        </dl>
        <p id="key-helper"><Info size={18} />若短 Key 匹配多条记录，系统会提示继续补充字符。</p>
      </section>
      <aside className="lookup-security-reminder">
        <ShieldCheck size={20} weight="duotone" />
        <div>
          <strong>安全提醒</strong>
          <span>完整 Key 默认隐藏，仅在主动查看后显示 30 秒，且不会写入浏览器历史。</span>
        </div>
      </aside>
    </form>
  );
}
