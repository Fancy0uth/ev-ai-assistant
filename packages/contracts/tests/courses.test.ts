import { describe, expect, it } from 'vitest';
import { createCourseResourceSchema, createCourseSchema } from '../src/courses';

describe('course link contracts', () => {
  const courseInput = {
    termId: '00000000-0000-4000-8000-000000000511',
    title: '安全的课程档案',
  };

  it('accepts only HTTP(S) course and resource links', () => {
    expect(createCourseSchema.safeParse({ ...courseInput, officialUrl: 'https://example.edu/course' }).success).toBe(true);
    expect(createCourseResourceSchema.safeParse({ title: '讲义', url: 'http://example.edu/week-1' }).success).toBe(true);

    for (const unsafeUrl of ['javascript:alert(1)', 'data:text/html,unsafe', 'file:///C:/private/course']) {
      expect(createCourseSchema.safeParse({ ...courseInput, officialUrl: unsafeUrl }).success).toBe(false);
      expect(createCourseResourceSchema.safeParse({ title: '危险资料', url: unsafeUrl }).success).toBe(false);
    }
  });
});
