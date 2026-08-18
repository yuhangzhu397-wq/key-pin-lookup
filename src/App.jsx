import { useState } from 'react';
import Header from './components/Header.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import ResultPanel from './components/ResultPanel.jsx';
import Feedback from './components/Feedback.jsx';
import TpmMonitor from './components/TpmMonitor.jsx';
import QuotaExplorer from './components/QuotaExplorer.jsx';
import UsageMonitor from './components/UsageMonitor.jsx';

const KEY_PATTERN = /^(?:pk-[a-zA-Z0-9_-]{4,509}|key-[a-zA-Z0-9_-]{3,508})$/;

function messageForResponse(status, payload) {
  if (status === 404) {
    return {
      title: '没有查询到对应 PIN',
      detail: '请检查 Key 前缀是否正确、是否属于当前环境，或是否已经失效。',
    };
  }

  if (status === 409) {
    return {
      title: '匹配到多个 Key',
      detail: '请继续输入更多字符，直到能够唯一定位对应的 PIN。',
    };
  }

  return {
    title: '查询失败',
    detail: payload?.message || '服务暂时不可用，请稍后重试。',
  };
}

export default function App() {
  const [page, setPage] = useState(() => {
    if (window.location.hash === '#tpm') return 'tpm';
    if (window.location.hash === '#quota') return 'quota';
    if (window.location.hash === '#usage') return 'usage';
    return 'lookup';
  });
  const [keyValue, setKeyValue] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(null);
  async function handleSubmit(event) {
    event.preventDefault();
    const key = keyValue.trim();

    setResult(null);

    if (!KEY_PATTERN.test(key)) {
      setMessage({
        title: 'Key 格式不正确',
        detail: '请输入 pk- 或 key- 开头，且总长度至少为 7 位的 Key 或 Key ID。',
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(messageForResponse(response.status, payload));
        return;
      }

      setResult(payload);
    } catch {
      setMessage({
        title: '无法连接查询服务',
        detail: '请确认内网连接和服务状态后重试。',
      });
    } finally {
      setLoading(false);
    }
  }

  function handleChange(event) {
    setKeyValue(event.target.value);
    setResult(null);
    setMessage(null);
  }

  function handlePageChange(nextPage) {
    setPage(nextPage);
    const hash = nextPage === 'tpm' ? '#tpm' : nextPage === 'quota' ? '#quota' : nextPage === 'usage' ? '#usage' : window.location.pathname;
    window.history.replaceState(null, '', hash);
  }

  return (
    <div className={`app-shell page-${page}`}>
      <Header page={page} onPageChange={handlePageChange} />
      <main className={`main-content ${page === 'quota' || page === 'usage' ? 'main-content-wide' : ''} ${page === 'lookup' ? 'lookup-main' : ''}`}>
        {page === 'tpm' ? <TpmMonitor /> : page === 'quota' ? <QuotaExplorer /> : page === 'usage' ? <UsageMonitor /> : <>
        <section className="page-intro lookup-intro" aria-labelledby="page-title">
          <h1 id="page-title">Key 归属与凭证查询</h1>
          <p>输入 Key ID、完整 Key 或含前缀的前 7 位，查询所属 PIN 并安全获取完整 API Key。</p>
        </section>

        <div className="lookup-workspace">
          <SearchPanel
            value={keyValue}
            visible={keyVisible}
            loading={loading}
            onChange={handleChange}
            onToggleVisibility={() => setKeyVisible((current) => !current)}
            onSubmit={handleSubmit}
          />

          <div className="lookup-result-column" aria-live="polite">
            <Feedback message={message} />
            <ResultPanel result={result} loading={loading} />
          </div>
        </div>
        </>}
      </main>
    </div>
  );
}
