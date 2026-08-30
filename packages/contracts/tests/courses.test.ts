import { describe, expect, it } from 'vitest';
import { createCourseResourceSchema, createCourseSchema } from '../src/courses';
import { createCourseImportSchema } from '../src/course-import';

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

  it('accepts an Owner-owned local artifact reference instead of Base64 image JSON', () => {
    const parsed = createCourseImportSchema.parse({
      termId: '00000000-0000-4000-8000-000000000001',
      artifactId: '00000000-0000-4000-8000-000000000002',
    });

    expect(parsed).toEqual({
      termId: '00000000-0000-4000-8000-000000000001',
      artifactId: '00000000-0000-4000-8000-000000000002',
    });
    expect(() =>
      createCourseImportSchema.parse({
        termId: '00000000-0000-4000-8000-000000000001',
        image: { mimeType: 'image/png', base64: 'aGVsbG8=' },
      }),
    ).toThrow();
  });
});
