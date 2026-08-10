'use client';

import type { Task, TaskArea, TaskPriority } from '@ev/contracts';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';

export interface TaskFormValues {
  title: string;
  area: TaskArea;
  priority: TaskPriority;
  targetDate: string | null;
}

interface TaskFormFieldsProps {
  prefix: '新建任务' | '编辑任务';
  values: TaskFormValues;
  titleRef?: RefObject<HTMLInputElement | null>;
  onChange: (values: TaskFormValues) => void;
}

const initialValues: TaskFormValues = {
  title: '',
  area: 'WORK',
  priority: 'MEDIUM',
  targetDate: null,
};

function taskValues(task: Task): TaskFormValues {
  return {
    title: task.title,
    area: task.area,
    priority: task.priority,
    targetDate: task.targetDate,
  };
}

function TaskFormFields({ prefix, values, titleRef, onChange }: TaskFormFieldsProps) {
  const inputId = prefix === '新建任务' ? 'task-create' : 'task-edit';
  return (
    <div className="task-editor__fields">
      <label>
        {prefix}标题
        <input
          ref={titleRef}
          id={`${inputId}-title`}
          value={values.title}
          maxLength={200}
          onChange={(event) => onChange({ ...values, title: event.target.value })}
        />
      </label>
      <label>
        {prefix}领域
        <select
          id={`${inputId}-area`}
          value={values.area}
          onChange={(event) => onChange({ ...values, area: event.target.value as TaskArea })}
        >
          <option value="WORK">工作</option>
          <option value="STUDY">学习</option>
          <option value="LIFE">生活</option>
        </select>
      </label>
      <label>
        {prefix}优先级
        <select
          id={`${inputId}-priority`}
          value={values.priority}
          onChange={(event) => onChange({ ...values, priority: event.target.value as TaskPriority })}
        >
          <option value="LOW">低</option>
          <option value="MEDIUM">中</option>
          <option value="HIGH">高</option>
        </select>
      </label>
      <label>
        {prefix}目标日期
        <input
          id={`${inputId}-date`}
          type="date"
          value={values.targetDate ?? ''}
          onChange={(event) => onChange({ ...values, targetDate: event.target.value || null })}
        />
      </label>
    </div>
  );
}

function validationMessage(values: TaskFormValues): string | null {
  return values.title.trim() ? null : '请先写下任务标题';
}

export function TaskCreator({
  isPending,
  onCreate,
}: {
  isPending: boolean;
  onCreate: (values: TaskFormValues) => Promise<boolean>;
}) {
  const [values, setValues] = useState<TaskFormValues>(initialValues);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const error = validationMessage(values);
    setValidationError(error);
    if (error) return;
    if (await onCreate({ ...values, title: values.title.trim() })) {
      setValues(initialValues);
    }
  }

  return (
    <form className="task-creator" onSubmit={(event) => void submit(event)} noValidate>
      <h2>创建任务</h2>
      <TaskFormFields prefix="新建任务" values={values} onChange={setValues} />
      <button type="submit" disabled={isPending}>
        {isPending ? '正在创建…' : '创建任务'}
      </button>
      {validationError ? <p role="alert">{validationError}</p> : null}
    </form>
  );
}

export function TaskEditor({
  task,
  isPending,
  onSave,
  onCancel,
}: {
  task: Task;
  isPending: boolean;
  onSave: (values: TaskFormValues) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<TaskFormValues>(() => taskValues(task));
  const [validationError, setValidationError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValues(taskValues(task));
    titleRef.current?.focus();
  }, [task]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const error = validationMessage(values);
    setValidationError(error);
    if (error) return;
    if (await onSave({ ...values, title: values.title.trim() })) onCancel();
  }

  return (
    <form className="task-editor" onSubmit={(event) => void submit(event)} noValidate>
      <h3>编辑任务</h3>
      <TaskFormFields prefix="编辑任务" values={values} titleRef={titleRef} onChange={setValues} />
      <div className="task-editor__actions">
        <button type="submit" disabled={isPending}>
          {isPending ? '正在保存…' : '保存修改'}
        </button>
        <button type="button" disabled={isPending} onClick={onCancel}>
          取消编辑
        </button>
      </div>
      {validationError ? <p role="alert">{validationError}</p> : null}
    </form>
  );
}
