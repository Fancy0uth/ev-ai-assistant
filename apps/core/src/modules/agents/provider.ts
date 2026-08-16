import type { CourseImportImage } from '@ev/contracts';

export interface CourseScheduleVisionProvider {
  extract(input: { image: CourseImportImage }): Promise<unknown>;
}
