import { actions, button, section } from '../blocks';

export function freeAnnouncementBlocks(envName: string, text: string): any[] {
  return [
    section(text),
    actions([
      button('dibs_on_open', 'Dibs on…', envName, 'primary'),
      button('env_info', 'Info', envName),
    ]),
  ];
}

export function busyAnnouncementBlocks(envName: string, text: string): any[] {
  return [
    section(text),
    actions([
      button('join_queue', 'Join queue', envName, 'primary'),
      button('env_info', 'Info', envName),
    ]),
  ];
}
