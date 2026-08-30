'use client';

import {
  courseListResponseSchema,
  courseResourceListResponseSchema,
  courseResourceResponseSchema,
  courseResponseSchema,
  termListResponseSchema,
  type Course,
  type CourseResource,
  type Term,
} from '@ev/contracts';
import { BookOpenCheck, Link2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CoreClientError, requestCore } from '@/lib/core-client';

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '课程档案暂时未保存，请稍后重试。';
}

export function LearningWorkspace() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [resources, setResources] = useState<Record<string, CourseResource[]>>({});
  const [termId, setTermId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [officialUrl, setOfficialUrl] = useState('');
  const [resourceTitle, setResourceTitle] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingCourse, setIsSavingCourse] = useState(false);
  const [isSavingResource, setIsSavingResource] = useState(false);

  useEffect(() => {
    void Promise.all([requestCore('terms', { method: 'GET' }), requestCore('courses', { method: 'GET' })])
      .then(([termPayload, coursePayload]) => {
        const loadedTerms = termListResponseSchema.parse(termPayload).data;
        const loadedCourses = courseListResponseSchema.parse(coursePayload).data;
        setTerms(loadedTerms);
        setCourses(loadedCourses);
        setTermId(loadedTerms[0]?.id ?? '');
        setCourseId(loadedCourses[0]?.id ?? '');
      })
      .catch((error: unknown) => setFailure(failureMessage(error)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!courseId || resources[courseId]) return;
    void requestCore(`courses/${courseId}/resources`, { method: 'GET' })
      .then((payload) => setResources((current) => ({ ...current, [courseId]: courseResourceListResponseSchema.parse(payload).data })))
      .catch((error: unknown) => setFailure(failureMessage(error)));
  }, [courseId, resources]);

  async function createCourse(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setIsSavingCourse(true);
    try {
      const payload = await requestCore('courses', {
        method: 'POST',
        body: JSON.stringify({ termId, title: courseTitle, ...(officialUrl ? { officialUrl } : {}) }),
      });
      const course = courseResponseSchema.parse(payload).data;
      setCourses((current) => [...current, course]);
      setCourseId(course.id);
      setCourseTitle('');
      setOfficialUrl('');
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsSavingCourse(false);
    }
  }

  async function addResource(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!courseId) return;
    setFailure(null);
    setIsSavingResource(true);
    try {
      const payload = await requestCore(`courses/${courseId}/resources`, {
        method: 'POST', body: JSON.stringify({ title: resourceTitle, url: resourceUrl }),
      });
      const resource = courseResourceResponseSchema.parse(payload).data;
      setResources((current) => ({ ...current, [courseId]: [...(current[courseId] ?? []), resource] }));
      setResourceTitle('');
      setResourceUrl('');
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsSavingResource(false);
    }
  }

  const selectedCourse = courses.find((course) => course.id === courseId);

  return (
    <section className="domain-workspace" aria-labelledby="learning-heading">
      <header className="domain-workspace__header">
        <p className="section-kicker">LEARNING / COURSE PROFILE</p>
        <h1 id="learning-heading">学习与课程</h1>
        <p>每门课程独立保存官网、你提供的资料和后续学习上下文；公开检索的资料将始终带来源标记。</p>
      </header>

      <div className="domain-workspace__grid learning-workspace__grid">
        <form className="domain-card domain-form" onSubmit={(event) => void createCourse(event)}>
          <div className="domain-card__heading"><BookOpenCheck aria-hidden="true" size={19} /><div><h2>建立课程档案</h2><p>课程需要归属到一个本地学期。</p></div></div>
          <label>归属学期<select value={termId} disabled={terms.length === 0} onChange={(event) => setTermId(event.target.value)}><option value="">选择学期</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.title}</option>)}</select></label>
          <label>课程名称<input value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} /></label>
          <label>课程官网或课程平台链接<input type="url" value={officialUrl} onChange={(event) => setOfficialUrl(event.target.value)} /></label>
          {!isLoading && terms.length === 0 ? <p className="domain-form__hint">先在“日程与课表”建立学期，才能建立课程档案。</p> : null}
          <button disabled={!termId || isSavingCourse} type="submit"><Save aria-hidden="true" size={16} /> {isSavingCourse ? '正在保存…' : '建立课程档案'}</button>
        </form>

        <aside className="domain-card course-profile">
          <p className="section-kicker">COURSE PROFILE</p>
          {courses.length === 0 ? <><h2>还没有课程档案</h2><p>建立后，可以将每门课的官网、周纲和资料与它绑定。</p></> : <>
            <h2>选择课程</h2>
            <ul className="course-list">{courses.map((course) => <li key={course.id}><button aria-pressed={course.id === courseId} type="button" onClick={() => setCourseId(course.id)}>选择课程：{course.title}</button><Link href={`/courses/${course.id}`}>打开课程详情</Link></li>)}</ul>
            {selectedCourse?.officialUrl ? <a className="course-profile__link" href={selectedCourse.officialUrl} rel="noreferrer" target="_blank">打开课程官网</a> : null}
          </>}
        </aside>
      </div>

      {selectedCourse ? <div className="domain-workspace__grid learning-workspace__grid">
        <form className="domain-card domain-form" onSubmit={(event) => void addResource(event)}>
          <div className="domain-card__heading"><Link2 aria-hidden="true" size={19} /><div><h2>添加课程资料</h2><p>当前课程：{selectedCourse.title}</p></div></div>
          <label>课程资料标题<input value={resourceTitle} onChange={(event) => setResourceTitle(event.target.value)} /></label>
          <label>课程资料链接<input type="url" value={resourceUrl} onChange={(event) => setResourceUrl(event.target.value)} /></label>
          <button disabled={isSavingResource} type="submit"><Save aria-hidden="true" size={16} /> {isSavingResource ? '正在保存…' : '添加到本课程'}</button>
        </form>
        <aside className="domain-card course-profile">
          <p className="section-kicker">SOURCES</p><h2>{selectedCourse.title} 的资料</h2>
          {(resources[selectedCourse.id] ?? []).length > 0 ? <ul className="term-list">{resources[selectedCourse.id]?.map((resource) => <li key={resource.id}><a href={resource.url} rel="noreferrer" target="_blank">{resource.title}</a><small>{resource.source === 'USER_PROVIDED' ? '你提供的资料' : '公开搜索结果'}</small></li>)}</ul> : <p>还没有资料。</p>}
          <p className="domain-result__boundary">资料来自你提供的链接；后续公开搜索结果会单独标注来源。</p>
        </aside>
      </div> : null}
      {failure ? <p className="domain-form__error domain-workspace__error" role="alert">{failure}</p> : null}
    </section>
  );
}
