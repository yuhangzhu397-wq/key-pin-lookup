import { Cloud } from '@phosphor-icons/react/dist/icons/Cloud';
import { Cube } from '@phosphor-icons/react/dist/icons/Cube';
import { OpenAiLogo } from '@phosphor-icons/react/dist/icons/OpenAiLogo';
import { FaAws, FaMicrosoft } from 'react-icons/fa';
import {
  SiAlibabacloud,
  SiAnthropic,
  SiBytedance,
  SiDeepseek,
  SiGooglecloud,
  SiGooglegemini,
  SiMeta,
  SiQwen,
} from 'react-icons/si';

const MODEL_BRANDS = [
  { pattern: /gpt|codex|openai|o[134](?:\b|-)/i, icon: OpenAiLogo, color: '#111827', background: '#eef0f3' },
  { pattern: /claude|anthropic/i, icon: SiAnthropic, color: '#c26b42', background: '#fff1ea' },
  { pattern: /deepseek/i, icon: SiDeepseek, color: '#4d6bfe', background: '#eef1ff' },
  { pattern: /qwen|通义/i, icon: SiQwen, color: '#615ced', background: '#f0efff' },
  { pattern: /gemini/i, icon: SiGooglegemini, color: '#4285f4', background: '#edf4ff' },
  { pattern: /doubao|豆包/i, icon: SiBytedance, color: '#325dff', background: '#edf2ff' },
  { pattern: /llama|meta/i, icon: SiMeta, color: '#0866ff', background: '#edf4ff' },
];

const SUPPLIER_BRANDS = [
  { pattern: /azure|microsoft/i, icon: FaMicrosoft, color: '#0078d4', background: '#edf7ff' },
  { pattern: /aws|amazon/i, icon: FaAws, color: '#ff9900', background: '#fff7e8' },
  { pattern: /huoshan|volcano|火山/i, icon: SiBytedance, color: '#325dff', background: '#edf2ff' },
  { pattern: /alibaba|aliyun|阿里/i, icon: SiAlibabacloud, color: '#ff6a00', background: '#fff2e9' },
  { pattern: /google|gcp/i, icon: SiGooglecloud, color: '#4285f4', background: '#edf4ff' },
  { pattern: /anthropic/i, icon: SiAnthropic, color: '#c26b42', background: '#fff1ea' },
];

export default function ResourceIcon({ type, name, size = 'medium' }) {
  const brands = type === 'supplier' ? SUPPLIER_BRANDS : MODEL_BRANDS;
  const match = brands.find((brand) => brand.pattern.test(String(name || '')));
  const Icon = match?.icon || (type === 'supplier' ? Cloud : Cube);
  const style = {
    '--resource-icon-color': match?.color || '#6257e8',
    '--resource-icon-background': match?.background || '#f0efff',
  };

  return (
    <span className={`resource-icon ${size}`} style={style} aria-hidden="true">
      <Icon />
    </span>
  );
}
