import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ToastComponent } from './toast.component';
import { ToastService } from '../../services/toast.service';

describe('ToastComponent', () => {
  let fixture: ComponentFixture<ToastComponent>;
  let comp:    ToastComponent;
  let svc:     ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToastComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ToastComponent);
    comp    = fixture.componentInstance;
    svc     = TestBed.inject(ToastService);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(comp).toBeTruthy();
  });

  it('exposes the ToastService as toastService', () => {
    expect(comp.toastService).toBeInstanceOf(ToastService);
  });

  it('toastService.toasts() reflects toasts added via the service', () => {
    svc.success('Upload complete');
    expect(comp.toastService.toasts().length).toBe(1);
    expect(comp.toastService.toasts()[0]!.message).toBe('Upload complete');
  });

  it('toastService.toasts() reflects multiple toasts', () => {
    svc.success('First');
    svc.error('Second');
    expect(comp.toastService.toasts().length).toBe(2);
  });
});
