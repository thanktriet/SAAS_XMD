import { ORDER_STATUS, ORDER_STATUS_STEPS } from '../../../utils/helpers';

interface StatusProgressBarProps {
  currentStatus: string;
}

export default function StatusProgressBar({ currentStatus }: StatusProgressBarProps) {
  const isCancelled = currentStatus === 'cancelled';
  const currentIdx = ORDER_STATUS_STEPS.indexOf(currentStatus as any);

  return (
    <div className="m-status-progress">
      {ORDER_STATUS_STEPS.map((step, idx) => {
        let cls = 'm-status-step';
        if (isCancelled) {
          cls += ' cancelled';
        } else if (idx < currentIdx) {
          cls += ' done';
        } else if (idx === currentIdx) {
          cls += ' current';
        }

        return (
          <div key={step} className={cls}>
            {idx < ORDER_STATUS_STEPS.length - 1 && <div className="m-status-step-line" />}
            <div className="m-status-step-dot" />
            <span className="m-status-step-label">
              {ORDER_STATUS[step]?.label || step}
            </span>
          </div>
        );
      })}
    </div>
  );
}
