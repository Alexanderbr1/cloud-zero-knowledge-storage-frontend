import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { ActivityComponent } from './activity.component';
import { AuditService } from '../../services/audit.service';
import { AuditEvent } from '../../models/audit.model';
import { environment } from '../../../../../environments/environment';

const BASE = `${environment.apiBaseUrl}/audit`;

const EVT_LOGIN: AuditEvent = {
  id: 'e-1', event_type: 'login_success',
  ip_address: '127.0.0.1', device_name: 'Chrome', created_at: '2025-05-01T10:00:00Z',
};
const EVT_UPLOAD: AuditEvent = {
  id: 'e-2', event_type: 'file_uploaded',
  ip_address: '127.0.0.1', device_name: 'Chrome',
  resource_name: 'report.pdf', created_at: '2025-05-01T09:00:00Z',
};
const EVT_FOLDER: AuditEvent = {
  id: 'e-3', event_type: 'folder_created',
  ip_address: '127.0.0.1', device_name: 'Chrome',
  resource_name: 'Docs', created_at: '2025-05-01T08:00:00Z',
};

describe('ActivityComponent', () => {
  let fixture: ComponentFixture<ActivityComponent>;
  let comp:    ActivityComponent;
  let http:    HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports:   [ActivityComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ActivityComponent);
    comp    = fixture.componentInstance;
    http    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ─── initial state ────────────────────────────────────────────────────────

  it('loading is true initially before first HTTP call completes', fakeAsync(() => {
    fixture.detectChanges(); // triggers ngOnInit
    expect(comp.loading()).toBeTrue();
    http.expectOne(r => r.url === BASE).flush({ events: [] });
    tick();
  }));

  it('events is empty initially', fakeAsync(() => {
    fixture.detectChanges();
    expect(comp.events().length).toBe(0);
    http.expectOne(r => r.url === BASE).flush({ events: [] });
    tick();
  }));

  // ─── ngOnInit — load ──────────────────────────────────────────────────────

  it('load() populates events from audit service', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN, EVT_UPLOAD] });
    tick();

    expect(comp.events()).toEqual([EVT_LOGIN, EVT_UPLOAD]);
    expect(comp.loading()).toBeFalse();
  }));

  it('load() sets hasMore=true when returned events == PAGE_SIZE (50)', fakeAsync(() => {
    fixture.detectChanges();
    const fifty = Array.from({ length: 50 }, (_, i) => ({ ...EVT_LOGIN, id: `e-${i}` }));
    http.expectOne(r => r.url === BASE).flush({ events: fifty });
    tick();

    expect(comp.hasMore()).toBeTrue();
  }));

  it('load() sets hasMore=false when returned events < 50', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN] });
    tick();

    expect(comp.hasMore()).toBeFalse();
  }));

  it('load() sets error signal on HTTP failure', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush('Error', { status: 500, statusText: 'Error' });
    tick();

    expect(comp.error()).toBeTruthy();
    expect(comp.loading()).toBeFalse();
  }));

  // ─── filteredEvents computed ──────────────────────────────────────────────

  it('filteredEvents returns all events when filter is "all"', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN, EVT_UPLOAD, EVT_FOLDER] });
    tick();

    comp.setFilter('all');
    expect(comp.filteredEvents().length).toBe(3);
  }));

  it('filteredEvents filters by "auth" category', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN, EVT_UPLOAD, EVT_FOLDER] });
    tick();

    comp.setFilter('auth');
    const types = comp.filteredEvents().map(e => e.event_type);
    expect(types).toEqual(['login_success']);
  }));

  it('filteredEvents filters by "files" category', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN, EVT_UPLOAD, EVT_FOLDER] });
    tick();

    comp.setFilter('files');
    const types = comp.filteredEvents().map(e => e.event_type);
    expect(types).toEqual(['file_uploaded']);
  }));

  it('filteredEvents filters by "folders" category', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN, EVT_UPLOAD, EVT_FOLDER] });
    tick();

    comp.setFilter('folders');
    const types = comp.filteredEvents().map(e => e.event_type);
    expect(types).toEqual(['folder_created']);
  }));

  it('filteredEvents filters by search query (resource_name)', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN, EVT_UPLOAD, EVT_FOLDER] });
    tick();

    comp.onSearchInput({ target: { value: 'report' } } as unknown as Event);
    const ids = comp.filteredEvents().map(e => e.id);
    expect(ids).toEqual(['e-2']); // EVT_UPLOAD has resource_name 'report.pdf'
  }));

  it('filteredEvents filters by search query (event label)', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN, EVT_UPLOAD, EVT_FOLDER] });
    tick();

    comp.onSearchInput({ target: { value: 'вход' } } as unknown as Event);
    const ids = comp.filteredEvents().map(e => e.id);
    expect(ids).toEqual(['e-1']); // 'login_success' → 'Вход в аккаунт'
  }));

  it('clearFilters() resets filter and search', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN, EVT_UPLOAD, EVT_FOLDER] });
    tick();

    comp.setFilter('auth');
    comp.onSearchInput({ target: { value: 'вход' } } as unknown as Event);
    comp.clearFilters();

    expect(comp.activeFilter()).toBe('all');
    expect(comp.searchQuery()).toBe('');
    expect(comp.filteredEvents().length).toBe(3);
  }));

  // ─── loadMore ─────────────────────────────────────────────────────────────

  it('loadMore() appends new events and passes cursor', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [EVT_LOGIN] });
    tick();

    comp.loadMore();
    tick();

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.params.get('before')).toBe(EVT_LOGIN.created_at);
    req.flush({ events: [EVT_UPLOAD] });
    tick();

    expect(comp.events()).toEqual([EVT_LOGIN, EVT_UPLOAD]);
    expect(comp.loadingMore()).toBeFalse();
  }));

  it('loadMore() does nothing when events list is empty', fakeAsync(() => {
    fixture.detectChanges();
    http.expectOne(r => r.url === BASE).flush({ events: [] });
    tick();

    comp.loadMore();
    tick();

    http.expectNone(r => r.url === BASE);
  }));
});
