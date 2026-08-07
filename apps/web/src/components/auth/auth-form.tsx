'use client';

import { credentialsSchema } from '@ev/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

interface AuthFormProps {
  mode: 'setup' | 'login';
}

function validationMessage(username: string, password: string): string | null {
  const result = credentialsSchema.safeParse({ username, password });
  if (result.success) return null;

  const usernameInvalid = result.error.issues.some(({ path }) => path[0] === 'username');
  const passwordInvalid = result.error.issues.some(({ path }) => path[0] === 'password');
  if (usernameInvalid && passwordInvalid) {
    return '用户名至少 3 个字符；密码至少 12 个字符';
  }
  if (usernameInvalid) return '用户名需为 3–32 个字符，可使用字母、数字、点、下划线和连字符';
  return '密码至少 12 个字符，最多 128 个字符';
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const isSetup = mode === 'setup';

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const invalidMessage = validationMessage(username, password);
    if (invalidMessage) {
      setError(invalidMessage);
      return;
    }

    setIsPending(true);
    try {
      await requestCore(`auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      router.replace('/today');
    } catch (requestError) {
      if (
        isSetup &&
        requestError instanceof CoreClientError &&
        requestError.code === 'SETUP_ALREADY_COMPLETED'
      ) {
        router.replace('/login');
        return;
      }
      setError(
        requestError instanceof CoreClientError
          ? requestError.message
          : '本地 Core 暂时不可用，请确认服务已启动',
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="auth-panel">
      <header className="auth-panel__header">
        <p className="system-kicker">{isSetup ? '首次启动 / 01' : 'Owner Access / 02'}</p>
        <h1>{isSetup ? '建立本地身份' : '返回你的控制台'}</h1>
        <p>
          {isSetup
            ? '账号、任务和后续记忆都保存在这台电脑。现在只创建唯一的本地 Owner。'
            : '登录后继续查看今天的负载、任务进度与 Agent 能力状态。'}
        </p>
      </header>

      <form className="auth-form" noValidate onSubmit={(event) => void submit(event)}>
        <div className="field-group">
          <label htmlFor={`${mode}-username`}>用户名</label>
          <input
            id={`${mode}-username`}
            name="username"
            type="text"
            autoComplete="username"
            minLength={3}
            maxLength={32}
            value={username}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${mode}-form-error` : undefined}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="例如：codex"
          />
          <p className="field-hint">3–32 个字符，仅用于这台电脑。</p>
        </div>

        <div className="field-group">
          <label htmlFor={`${mode}-password`}>密码</label>
          <input
            id={`${mode}-password`}
            name="password"
            type="password"
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            minLength={12}
            maxLength={128}
            value={password}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${mode}-form-error` : undefined}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 12 个字符"
          />
          <p className="field-hint">密码经 scrypt 处理，原文不会写入数据库。</p>
        </div>

        {error ? (
          <div className="form-alert" id={`${mode}-form-error`} role="alert">
            <span aria-hidden="true">!</span>
            <p>{error}</p>
          </div>
        ) : null}

        <button className="primary-button" type="submit" disabled={isPending}>
          {isPending ? '正在连接本地 Core…' : isSetup ? '创建本地账号' : '登录'}
        </button>
      </form>

      <p className="auth-switch">
        {isSetup ? '已经初始化过？' : '这是首次启动？'}{' '}
        <Link href={isSetup ? '/login' : '/setup'}>
          {isSetup ? '转到登录' : '创建本地账号'}
        </Link>
      </p>
    </div>
  );
}
