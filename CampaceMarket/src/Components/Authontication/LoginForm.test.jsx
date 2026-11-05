import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginForm from './LoginForm';
import { LanguageProvider } from '../../context/LanguageContext';

describe('LoginForm Google session recovery', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('sends a redirect fragment token and credentials when restoring a Google session', async () => {
    window.history.replaceState({}, '', '/login?oauth=success#access_token=callback-token');
    const onLoginSuccess = vi.fn();
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        role: 'student',
        access_token: 'callback-token',
        user: { studentId: 'student-1' },
      }),
    });

    await act(async () => {
      render(
        <LanguageProvider>
          <LoginForm onLoginSuccess={onLoginSuccess} />
        </LanguageProvider>,
      );
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [requestUrl, requestOptions] = fetchMock.mock.calls[0];
    expect(requestUrl).toContain('/api/auth/session');
    expect(requestOptions.credentials).toBe('include');
    expect(requestOptions.headers.Authorization).toBe('Bearer callback-token');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'student-1', access_token: 'callback-token' }),
      'student',
    ));
  });

  it('uses the saved student access token when no token is in the callback URL', async () => {
    window.history.replaceState({}, '', '/login?oauth=success');
    window.localStorage.setItem('campaceSession', JSON.stringify({
      userRole: 'student',
      user: { access_token: 'saved-token' },
    }));
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        role: 'student',
        access_token: 'saved-token',
        user: { studentId: 'student-1' },
      }),
    });

    await act(async () => {
      render(
        <LanguageProvider>
          <LoginForm onLoginSuccess={vi.fn()} />
        </LanguageProvider>,
      );
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer saved-token');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
  });
});
