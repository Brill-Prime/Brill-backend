# Admin Authentication API Documentation

All endpoints are prefixed with `/admin`. Authentication is required for most endpoints except login and password reset.

---

## 1. Admin Login (Step 1: Password)
**POST** `/admin/login`

Request:
```
{
  "email": "admin@example.com",
  "password": "yourpassword"
}
```
Response:
- `200 OK` `{ success: true, message: "OTP sent to admin email. Please verify." }`
- `401 Unauthorized` `{ success: false, error: "Invalid admin credentials" }`

---

## 2. Admin Login (Step 2: OTP Verification)
**POST** `/admin/login/verify`

Request:
```
{
  "otp": "123456"
}
```
Response:
- `200 OK` `{ success: true, user: { ... } }`
- `401 Unauthorized` `{ success: false, error: "Invalid or expired OTP" }`

---

## 3. Admin Logout
**POST** `/admin/logout`

Authentication: Required
Response:
- `200 OK` `{ success: true }`

---

## 4. Admin Registration (Super-admin only)
**POST** `/admin/register`

Authentication: Super-admin required
Request:
```
{
  "email": "newadmin@example.com",
  "password": "yourpassword",
  "fullName": "Admin Name",
  "phone": "1234567890",
  "invitationCode": "optional-code"
}
```
Response:
- `200 OK` `{ success: true, user: { ... } }`
- `403 Forbidden` `{ success: false, error: "Super-admin privileges required" }`

---

## 5. Request Password Reset (OTP)
**POST** `/admin/password-reset/request`

Request:
```
{
  "email": "admin@example.com"
}
```
Response:
- `200 OK` `{ success: true, message: "OTP sent to email" }`
- `404 Not Found` `{ success: false, error: "Admin not found" }`

---

## 6. Confirm Password Reset
**POST** `/admin/password-reset/confirm`

Request:
```
{
  "email": "admin@example.com",
  "otp": "123456",
  "newPassword": "newpassword"
}
```
Response:
- `200 OK` `{ success: true, message: "Password updated" }`
- `400 Bad Request` `{ success: false, error: "Invalid or expired OTP" }`

---

## 7. View Admin Profile
**GET** `/admin/profile`

Authentication: Required
Response:
- `200 OK` `{ success: true, user: { ... } }`

---

## 8. Update Admin Profile
**PUT** `/admin/profile`

Authentication: Required
Request:
```
{
  "fullName": "New Name",
  "phone": "9876543210"
}
```
Response:
- `200 OK` `{ success: true }`

---

## 9. View Current Session
**GET** `/admin/session`

Authentication: Required
Response:
- `200 OK` `{ success: true, session: { ... } }`

---

## 10. Revoke Current Session
**POST** `/admin/session/revoke`

Authentication: Required
Response:
- `200 OK` `{ success: true, message: "Session revoked" }`

---

## Notes
- All endpoints return JSON responses.
- Audit logging is performed for all key admin actions.
- MFA (OTP via email) is required for login.
- Registration is restricted to super-admins or invitation code.
- Session management allows viewing and revoking the current session.
