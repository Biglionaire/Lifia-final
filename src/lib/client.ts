// =============================================================================
// Axios HTTP client for the ACP API.
// =============================================================================

import axios, { AxiosError, AxiosResponse } from "axios";
import dotenv from "dotenv";
import { loadApiKey } from "./config.js";

dotenv.config();

// Ensure API key is loaded from config
loadApiKey();

const client = axios.create({
  baseURL: "https://claw-api.virtuals.io",
  headers: {
    "x-api-key": process.env.LITE_AGENT_API_KEY,
  },
});

// List of HTTP status codes that should trigger a retry (transient errors)
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Utility function to retry a request with exponential backoff.
 * @param fn - The async function to retry (should return a Promise)
 * @param maxRetries - Maximum number of retry attempts after initial failure (default: 3, meaning 4 total attempts)
 * @param initialDelayMs - Initial delay in milliseconds (default: 1000)
 * @returns The result of the successful request
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if this is a retryable error
      const isRetryable = isRetryableError(error);
      
      // If not retryable or we've exhausted retries, throw immediately
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      // Calculate delay with exponential backoff: initialDelay * 2^attempt
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      
      console.warn(
        `[retry] Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms...`
      );
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  // This should never be reached, but TypeScript requires it
  throw lastError;
}

/**
 * Determines if an error should trigger a retry.
 * Retries on:
 * - Network errors (no response)
 * - Transient HTTP status codes (408, 429, 500, 502, 503, 504)
 */
function isRetryableError(error: any): boolean {
  // Network error (no response received)
  if (!error.response) {
    return true;
  }
  
  // Check if status code is in the retryable list
  const status = error.response?.status;
  return RETRYABLE_STATUS_CODES.includes(status);
}

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      
      // Check if response data is HTML (common for Cloudflare error pages)
      if (typeof data === 'string' && (data.startsWith('<!DOCTYPE') || data.startsWith('<html'))) {
        throw new Error(`API error ${status}: upstream returned HTML (likely Cloudflare error page)`);
      }
      
      throw new Error(JSON.stringify(data));
    }
    throw error;
  }
);

export default client;
