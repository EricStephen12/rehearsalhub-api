import { Request, Response, NextFunction } from 'express';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'];

  if (!key || key !== process.env.API_SECRET_KEY) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized. Provide a valid x-api-key header.',
    });
    return;
  }

  next();
}
