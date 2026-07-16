import { CheckIcon, CopyIcon } from '../icons.jsx';

export default function ResultPanel({ result, copied, onCopy }) {
  return (
    <section className="result-section" aria-labelledby="result-heading">
      <div className="result-heading-row">
        <h2 id="result-heading">查询结果</h2>
        <span className="success-label">
          <CheckIcon />
          查询成功
        </span>
      </div>
      <div className="result-panel">
        <div className="pin-block">
          <span className="result-label">所属 PIN</span>
          <strong className="pin-value">{result.pin}</strong>
        </div>
        <dl className="result-details">
          <div>
            <dt>Key ID</dt>
            <dd>{result.keyId || '—'}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd className="status-value">唯一匹配</dd>
          </div>
        </dl>
        <button className="copy-button" type="button" onClick={onCopy}>
          <CopyIcon />
          {copied ? '已复制' : '复制 PIN'}
        </button>
      </div>
    </section>
  );
}
