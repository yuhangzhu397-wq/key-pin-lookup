import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, CircleNotch, Copy, Eye, EyeSlash, Key, ShieldCheck } from '@phosphor-icons/react';

const REVEAL_SECONDS = 30;

function labelForKeyType(value) {
  if (!value) return '未标注';
  if (value === 'autoBind') return '员工小 Key';
  if (value === 'pin' || value === 'user') return 'PIN 直属 Key';
  return value;
}

function maskApiKey(value) {
  if (!value) return '—';
  const prefix = value.startsWith('pk-') ? 'pk-' : '';
  const suffix = value.length > 7 ? value.slice(-4) : '';
  return `${prefix}${'•'.repeat(24)}${suffix}`;
}

export default function ResultPanel({ result, loading }) {
  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_SECONDS);
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');

  useEffect(() => {
    setRevealed(false);
    setSecondsLeft(REVEAL_SECONDS);
    setCopied('');
    setCopyError('');
  }, [result?.apiKey]);

  useEffect(() => {
    if (!revealed) return undefined;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          setRevealed(false);
          return REVEAL_SECONDS;
        }
        return current - 1;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [revealed]);

  const displayKey = useMemo(
    () => (revealed ? result?.apiKey : maskApiKey(result?.apiKey)),
    [result?.apiKey, revealed],
  );

  async function copyValue(value, field) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      setCopyError('');
      window.setTimeout(() => setCopied(''), 1_800);
    } catch {
      setCopyError('浏览器未允许访问剪贴板，请手动选择并复制。');
    }
  }

  function toggleReveal() {
    setRevealed((current) => {
      if (current) return false;
      setSecondsLeft(REVEAL_SECONDS);
      return true;
    });
  }

  if (loading) {
    return (
      <section className="lookup-detail lookup-detail-loading" aria-busy="true">
        <CircleNotch className="lookup-loading-spinner" size={30} />
        <strong>正在查询归属关系…</strong>
        <span>系统仅会在唯一匹配时返回完整凭证。</span>
      </section>
    );
  }

  if (!result) {
    return (
      <section className="lookup-detail lookup-detail-empty">
        <span className="lookup-empty-icon"><Key size={30} weight="duotone" /></span>
        <h2>归属详情</h2>
        <p>完成查询后，这里会显示所属 PIN、Key ID 和完整 API Key。</p>
      </section>
    );
  }

  return (
    <section className="lookup-detail" aria-labelledby="result-heading">
      <div className="lookup-detail-heading">
        <div>
          <h2 id="result-heading">归属详情</h2>
          <p>已从当前 MaaS 数据源定位到唯一记录</p>
        </div>
        <span className="success-label"><CheckCircle size={19} weight="fill" />唯一匹配</span>
      </div>

      <div className="lookup-pin-hero">
        <div>
          <span>所属 PIN</span>
          <strong>{result.pin}</strong>
        </div>
        <CheckCircle size={28} weight="duotone" aria-hidden="true" />
      </div>

      <dl className="lookup-detail-list">
        <div>
          <dt>Key ID</dt>
          <dd>{result.keyId || '—'}</dd>
          {result.keyId ? (
            <button type="button" onClick={() => copyValue(result.keyId, 'keyId')} aria-label="复制 Key ID">
              <Copy size={18} />{copied === 'keyId' ? '已复制' : '复制'}
            </button>
          ) : null}
        </div>
        <div><dt>Key 类型</dt><dd>{labelForKeyType(result.keyType)}</dd></div>
        <div><dt>关联应用</dt><dd>{result.appId || result.description || '未关联应用'}</dd></div>
        {result.erp ? <div><dt>使用人 ERP</dt><dd>{result.erp}</dd></div> : null}
      </dl>

      <div className="lookup-credential">
        <div className="credential-title">
          <div>
            <ShieldCheck size={20} weight="duotone" />
            <h3>完整 API Key <span>敏感</span></h3>
          </div>
          {revealed ? <small>{secondsLeft} 秒后自动隐藏</small> : null}
        </div>
        <div className="credential-control">
          <code aria-label={revealed ? '完整 API Key' : '已脱敏的 API Key'}>{displayKey}</code>
          <button type="button" onClick={toggleReveal} aria-pressed={revealed}>
            {revealed ? <EyeSlash size={19} /> : <Eye size={19} />}
            {revealed ? '立即隐藏' : '显示 30 秒'}
          </button>
          <button type="button" onClick={() => copyValue(result.apiKey, 'apiKey')}>
            <Copy size={19} />{copied === 'apiKey' ? '已复制' : '复制'}
          </button>
        </div>
        <p><ShieldCheck size={17} />仅在授权场景下查看；30 秒后自动隐藏，工具不会写入浏览器或本地历史。</p>
        {copyError ? <span className="credential-copy-error" role="alert">{copyError}</span> : null}
      </div>
    </section>
  );
}
