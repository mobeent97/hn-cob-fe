import { DeviceStatus } from '../../core/data/models';

/** "Sold" in the data is a device fitted and reporting: screens call it "In service". */
export const STATUS_LABEL: Record<DeviceStatus, string> = {
  Available: 'Available',
  Allocated: 'Allocated',
  Sold: 'In service',
  Deactivated: 'Deactivated',
  Faulty: 'Faulty',
};
