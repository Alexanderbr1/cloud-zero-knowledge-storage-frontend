import { TestBed, ComponentFixture } from '@angular/core/testing';
import { FolderPickerComponent } from './folder-picker.component';
import { BreadcrumbItem, FolderItem } from '../../../features/storage/models/folder.model';

const FOLDER_A: FolderItem = { folder_id: 'f-1', parent_id: null,  name: 'Docs',    created_at: '' };
const FOLDER_B: FolderItem = { folder_id: 'f-2', parent_id: 'f-1', name: 'Reports', created_at: '' };
const FOLDER_C: FolderItem = { folder_id: 'f-3', parent_id: null,  name: 'Photos',  created_at: '' };

const ROOT_BREADCRUMB: BreadcrumbItem = { folder_id: null, name: 'Мои файлы' };

describe('FolderPickerComponent', () => {
  let fixture: ComponentFixture<FolderPickerComponent>;
  let comp:    FolderPickerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FolderPickerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FolderPickerComponent);
    comp    = fixture.componentInstance;

    fixture.componentRef.setInput('folders',     [FOLDER_A, FOLDER_B, FOLDER_C]);
    fixture.componentRef.setInput('breadcrumbs', [ROOT_BREADCRUMB]);
    fixture.detectChanges();
  });

  // ─── visibleFolders ───────────────────────────────────────────────────────

  it('visibleFolders() returns all folders when excludeFolderId is null', () => {
    fixture.componentRef.setInput('excludeFolderId', null);
    fixture.detectChanges();
    expect(comp.visibleFolders()).toEqual([FOLDER_A, FOLDER_B, FOLDER_C]);
  });

  it('visibleFolders() excludes the folder matching excludeFolderId', () => {
    fixture.componentRef.setInput('excludeFolderId', 'f-2');
    fixture.detectChanges();
    expect(comp.visibleFolders()).toEqual([FOLDER_A, FOLDER_C]);
  });

  it('visibleFolders() returns empty array when all are excluded', () => {
    fixture.componentRef.setInput('folders', [FOLDER_A]);
    fixture.componentRef.setInput('excludeFolderId', 'f-1');
    fixture.detectChanges();
    expect(comp.visibleFolders()).toEqual([]);
  });

  // ─── confirm ──────────────────────────────────────────────────────────────

  it('confirm() emits the folder_id of the last breadcrumb', () => {
    spyOn(comp.picked, 'emit');
    fixture.componentRef.setInput('breadcrumbs', [
      ROOT_BREADCRUMB,
      { folder_id: 'f-1', name: 'Docs' },
    ]);
    fixture.detectChanges();

    comp.confirm();

    expect(comp.picked.emit).toHaveBeenCalledWith('f-1');
  });

  it('confirm() emits null when at root (breadcrumb tail has null folder_id)', () => {
    spyOn(comp.picked, 'emit');
    fixture.componentRef.setInput('breadcrumbs', [ROOT_BREADCRUMB]);
    fixture.detectChanges();

    comp.confirm();

    expect(comp.picked.emit).toHaveBeenCalledWith(null);
  });

  // ─── navigation ───────────────────────────────────────────────────────────

  it('openFolder() emits navigateInto with the folder', () => {
    spyOn(comp.navigateInto, 'emit');
    comp.openFolder(FOLDER_A);
    expect(comp.navigateInto.emit).toHaveBeenCalledWith(FOLDER_A);
  });

  it('jumpTo() emits navigateTo with the breadcrumb index', () => {
    spyOn(comp.navigateTo, 'emit');
    comp.jumpTo(2);
    expect(comp.navigateTo.emit).toHaveBeenCalledWith(2);
  });

  // ─── cancel / Escape ──────────────────────────────────────────────────────

  it('cancel() emits cancelled', () => {
    spyOn(comp.cancelled, 'emit');
    comp.cancel();
    expect(comp.cancelled.emit).toHaveBeenCalled();
  });

  it('onEscape() emits cancelled via HostListener', () => {
    spyOn(comp.cancelled, 'emit');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(comp.cancelled.emit).toHaveBeenCalled();
  });

  // ─── defaults ─────────────────────────────────────────────────────────────

  it('title defaults to "Переместить"', () => {
    expect(comp.title()).toBe('Переместить');
  });

  it('loading defaults to false', () => {
    expect(comp.loading()).toBeFalse();
  });
});
