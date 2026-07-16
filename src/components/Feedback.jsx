export default function Feedback({ message }) {
  if (!message) return null;

  return (
    <div className="feedback" role="alert">
      <strong>{message.title}</strong>
      <span>{message.detail}</span>
    </div>
  );
}
