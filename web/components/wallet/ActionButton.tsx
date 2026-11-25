'use client';
import { useWallet } from './useWallet';

/**
 * Wallet-gated primary button: Connect → Switch network → disabled reason → action.
 * Every "Connect wallet" in the app goes through this so they all open the same modal.
 */
export function ActionButton({
  children, onClick, disabled, disabledLabel, busy, variant = 'chunky', className = '',
}: {
  children: React.ReactNode;
  onClick: () => void;
  /** When set, the button is disabled with this label even if connected (e.g. contracts not live). */
  disabledLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'chunky' | 'ghost';
  className?: string;
}) {
  const w = useWallet();
  const cls = `${variant === 'chunky' ? 'btn-chunky py-3' : 'btn-ghost py-2.5'} w-full disabled:cursor-not-allowed disabled:opacity-60 ${className}`;
  if (!w.connected) return <button type="button" className={cls} onClick={w.openConnect} disabled={w.connecting}>{w.connecting ? 'Connecting…' : 'Connect wallet'}</button>;
  if (disabledLabel) return <button type="button" className={cls} disabled>{disabledLabel}</button>;
  if (w.wrongChain) return <button type="button" className={cls} onClick={w.switchToBsc} disabled={w.switching}>{w.switching ? 'Switching…' : 'Switch to BNB Chain'}</button>;
  return <button type="button" className={cls} onClick={onClick} disabled={disabled || busy}>{children}</button>;
}
