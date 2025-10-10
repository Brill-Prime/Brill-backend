/**
 * Password strength validation utility
 */

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  strength: 'weak' | 'medium' | 'strong';
}

export class PasswordValidator {
  private static readonly MIN_LENGTH = 8;
  private static readonly MAX_LENGTH = 128;

  /**
   * Validate password strength
   */
  static validate(password: string): PasswordValidationResult {
    const errors: string[] = [];
    let strength: 'weak' | 'medium' | 'strong' = 'weak';

    // Check minimum length
    if (password.length < this.MIN_LENGTH) {
      errors.push(`Password must be at least ${this.MIN_LENGTH} characters long`);
    }

    // Check maximum length
    if (password.length > this.MAX_LENGTH) {
      errors.push(`Password must not exceed ${this.MAX_LENGTH} characters`);
    }

    // Check for uppercase letters
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    // Check for lowercase letters
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    // Check for numbers
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    // Check for special characters
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    // Check for common patterns
    const commonPatterns = [
      /^12345/,
      /^password/i,
      /^qwerty/i,
      /^admin/i,
      /^letmein/i,
      /^welcome/i,
      /(.)\1{3,}/ // Repeated characters
    ];

    for (const pattern of commonPatterns) {
      if (pattern.test(password)) {
        errors.push('Password contains common patterns and is too weak');
        break;
      }
    }

    // Calculate strength
    if (errors.length === 0) {
      const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
      const hasNumbers = /\d/.test(password);
      const hasUppercase = /[A-Z]/.test(password);
      const hasLowercase = /[a-z]/.test(password);
      const isLongEnough = password.length >= 12;

      const criteriaCount = [
        hasSpecialChars,
        hasNumbers,
        hasUppercase,
        hasLowercase,
        isLongEnough
      ].filter(Boolean).length;

      if (criteriaCount >= 5) {
        strength = 'strong';
      } else if (criteriaCount >= 4) {
        strength = 'medium';
      } else {
        strength = 'weak';
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      strength
    };
  }

  /**
   * Generate a strong password
   */
  static generate(length: number = 16): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = uppercase + lowercase + numbers + special;

    let password = '';
    
    // Ensure at least one of each type
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];

    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Shuffle the password
    return password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');
  }

  /**
   * Check if password has been compromised (basic check)
   * In production, integrate with Have I Been Pwned API
   */
  static async checkCompromised(password: string): Promise<boolean> {
    // Basic implementation - in production, use HIBP API
    const commonPasswords = [
      'password', '12345678', '123456789', 'qwerty', 'abc123',
      'monkey', '1234567', 'letmein', 'trustno1', 'dragon',
      'baseball', 'iloveyou', 'master', 'sunshine', 'ashley',
      'bailey', 'shadow', '123123', '654321', 'superman'
    ];

    return commonPasswords.some(common => 
      password.toLowerCase().includes(common)
    );
  }
}
