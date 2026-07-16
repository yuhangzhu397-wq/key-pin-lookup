import { useState } from 'react';
import Header from './components/Header.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import ResultPanel from './components/ResultPanel.jsx';
import Feedback from './components/Feedback.jsx';
import { InfoIcon } from './icons.jsx';

const KEY_PATTERN = /^(?:pk-|key-)[a-zA-Z0-9_-]{1,500}$/;

function messageForResponse(status, payload) {
  if (status === 404) {
    return {
      title: '没有查询到对应 PIN',
      detail: '请检查 Key 是否完整、是否属于当前环境，或是否已经失效。',
    };
  }

  if (status === 409) {
    return {
      title: '查询到多个归属',
      detail: '数据存在重复映射，请联系平台研发核查后再进行配额配置。',
    };
  }

  return {
    title: '查询失败',
    detail: payload?.message || '服务暂时不可用，请稍后重试。',
  };
}

export default function App() {
  const [keyValue, setKeyValue] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const key = keyValue.trim();

    setCopied(false);
    setResult(null);

    if (!KEY_PATTERN.test(key)) {
      setMessage({
        title: 'Key 格式不正确',
        detail: '请输入 pk- 开头的 API Key，或 key- 开头的 Key ID。',
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
    setCopied(false);
  }

  async function handleCopy() {
    if (!result?.pin) return;

    try {
      await navigator.clipboard.writeText(result.pin);
      setCopied(true);
    } catch {
      setMessage({
        title: '复制失败',
        detail: '浏览器未允许访问剪贴板，请手动选择并复制 PIN。',
      });
    }
  }

  return (
    <div className="app-shell">
      <Header />
      <main className="main-content">
        <section className="page-intro" aria-labelledby="page-title">
          <h1 id="page-title">查询 Key 对应的 PIN</h1>
          <p>输入 API Key 或 API Key ID，查询其所属账号。</p>
        </section>

        <SearchPanel
          value={keyValue}
          visible={keyVisible}
          loading={loading}
          onChange={handleChange}
          onToggleVisibility={() => setKeyVisible((current) => !current)}
          onSubmit={handleSubmit}
        />

        <div className="feedback-slot" aria-live="polite">
          <Feedback message={message} />
          {result ? <ResultPanel result={result} copied={copied} onCopy={handleCopy} /> : null}
        </div>

        <aside className="security-note">
          <InfoIcon />
          <span>工具自身不会在浏览器或本地历史中保存完整 Key；上游运维平台可能保留查询审计记录。</span>
        </aside>
      </main>
    </div>
  );
}
