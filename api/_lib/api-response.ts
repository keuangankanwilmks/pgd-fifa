export const sendApiError = (res: any, error: unknown, fallbackMessage = 'Permintaan gagal diproses') => {
  const statusCode = Number((error as any)?.statusCode || 500);
  const message = error instanceof Error ? error.message : String(error || fallbackMessage);
  return res.status(statusCode).json({ success: false, error: message });
};
