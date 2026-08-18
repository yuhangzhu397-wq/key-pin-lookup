export default function Header({ page, onPageChange }) {
  return (
    <header className="app-header">
      <div className="header-brand">
        <img className="brand-mark" src="/key-pin-logo.png" alt="" />
        <span>MaaS 运营工具</span>
      </div>
      <nav className="header-nav" aria-label="工具导航">
        <button className={page === 'lookup' ? 'active' : ''} type="button" onClick={() => onPageChange('lookup')}>Key 归属查询</button>
        <button className={page === 'tpm' ? 'active' : ''} type="button" onClick={() => onPageChange('tpm')}>TPM 总水位</button>
        <button className={page === 'quota' ? 'active' : ''} type="button" onClick={() => onPageChange('quota')}>上游供给</button>
        <button className={page === 'usage' ? 'active' : ''} type="button" onClick={() => onPageChange('usage')}>下游配额</button>
      </nav>
    </header>
  );
}
