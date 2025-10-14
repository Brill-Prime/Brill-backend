
import DOMPurify from 'isomorphic-dompurify';

export function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input, { 
    ALLOWED_TAGS: [], 
    ALLOWED_ATTR: [] 
  });
}

export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  const sanitized = {} as T;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key as keyof T] = sanitizeHtml(value) as any;
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key as keyof T] = sanitizeObject(value);
    } else {
      sanitized[key as keyof T] = value;
    }
  }
  return sanitized;
}
