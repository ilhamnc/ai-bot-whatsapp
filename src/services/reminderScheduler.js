// Scheduler membuat satu cron job per jam reminder aktif dan menyinkronkan perubahan dashboard.
import cron from 'node-cron';
import { TZ } from '../config.js';
import { getReminders, sendScheduledReminder } from '../models/reminderModel.js';

let jobs = new Map();

export function syncReminderSchedules(client, getIsReady) {
  for (const oldJob of jobs.values()) oldJob.stop();
  jobs = new Map();

  for (const reminder of getReminders()) {
    if (!reminder.enabled) continue;
    const expressions = reminder.cronExpressions || [reminder.cron];
    expressions.forEach((expression, index) => {
      if (!cron.validate(expression)) return;
      const task = cron.schedule(expression, () => {
        void sendScheduledReminder(client, getIsReady(), reminder.id);
      }, { timezone: TZ, noOverlap: true });
      jobs.set(`${reminder.id}:${index}`, task);
    });
  }
  console.log(`Jadwal reminder aktif: ${jobs.size}. Zona waktu: ${TZ}.`);
}

export function stopReminderSchedules() {
  for (const task of jobs.values()) task.stop();
  jobs.clear();
}
