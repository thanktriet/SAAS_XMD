import { useNavigate } from 'react-router-dom';

interface FABProps {
  visible: boolean;
}

export default function FAB({ visible }: FABProps) {
  const navigate = useNavigate();

  return (
    <button
      className={`m-fab${visible ? '' : ' m-fab-hidden'}`}
      onClick={() => navigate('/m/sales/new')}
      aria-label="Tạo đơn hàng mới"
    >
      <span className="m-fab-icon">＋</span>
      <span className="m-fab-label">Tạo đơn</span>
    </button>
  );
}
