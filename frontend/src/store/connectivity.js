import { create } from 'zustand';

/**
 * Corroborates the browser's navigator.onLine (unreliable alone — a machine
 * can report "online" while the local backend itself is unreachable) with
 * real request outcomes reported by the axios interceptor in api/client.js.
 */
export const useConnectivity = create(() => ({
  online: typeof navigator === 'undefined' || navigator.onLine,
}));

export const markOnline = () => useConnectivity.setState({ online: true });
export const markOffline = () => useConnectivity.setState({ online: false });

if (typeof window !== 'undefined') {
  window.addEventListener('online', markOnline);
  window.addEventListener('offline', markOffline);
}

export default useConnectivity;
