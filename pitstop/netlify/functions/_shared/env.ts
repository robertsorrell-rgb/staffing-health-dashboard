export function env(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim();
}

export function requiredEnv(key: string): string {
  const value = env(key);
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const AUTH_ALLOWED_DOMAIN =
  env("AUTH_ALLOWED_EMAIL_DOMAIN") || "varsitytutors.com";
