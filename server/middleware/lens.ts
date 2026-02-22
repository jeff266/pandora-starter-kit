import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      activeLens?: string | null;
    }
  }
}

export function lensMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const lens = (req.headers['x-pandora-lens'] as string) || (req.query.lens as string) || null;

  if (lens && typeof lens === 'string' && lens !== 'null' && lens !== '') {
    req.activeLens = lens;
  } else {
    req.activeLens = null;
  }

  next();
}
