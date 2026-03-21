export interface AvatarOption {
  id: string;
  src: string;
  label: string;
}

export const AVATAR_GALLERY: AvatarOption[] = [
  { id: 'char-01', src: '/avatars/char-01.png', label: 'Business Pro' },
  { id: 'char-02', src: '/avatars/char-02.png', label: 'Red Blazer' },
  { id: 'char-03', src: '/avatars/char-03.png', label: 'Tech Lead' },
  { id: 'char-04', src: '/avatars/char-04.png', label: 'Teal Analyst' },
  { id: 'char-05', src: '/avatars/char-05.png', label: 'Sales Rep' },
  { id: 'char-06', src: '/avatars/char-06.png', label: 'Executive' },
  { id: 'char-07', src: '/avatars/char-07.png', label: 'Mentor' },
  { id: 'char-08', src: '/avatars/char-08.png', label: 'Analyst' },
  { id: 'char-09', src: '/avatars/char-09.png', label: 'Creative Director' },
  { id: 'char-10', src: '/avatars/char-10.png', label: 'Ops Manager' },
  { id: 'char-11', src: '/avatars/char-11.png', label: 'Data Scientist' },
  { id: 'char-12', src: '/avatars/char-12.png', label: 'Startup Founder' },
  { id: 'char-13', src: '/avatars/char-13.png', label: 'Product Manager' },
  { id: 'char-14', src: '/avatars/char-14.png', label: 'Marketing Lead' },
  { id: 'char-15', src: '/avatars/char-15.png', label: 'Bold VP' },
  { id: 'char-16', src: '/avatars/char-16.png', label: 'SDR Rep' },
  { id: 'char-17', src: '/avatars/char-17.png', label: 'RevOps Pro' },
  { id: 'char-18', src: '/avatars/char-18.png', label: 'CFO' },
  { id: 'char-19', src: '/avatars/char-19.png', label: 'Engineer' },
  { id: 'char-20', src: '/avatars/char-20.png', label: 'Consultant' },
  { id: 'char-21', src: '/avatars/char-21.png', label: 'Bull' },
  { id: 'char-22', src: '/avatars/char-22.png', label: 'Bear' },
  { id: 'char-23', src: '/avatars/char-23.png', label: 'Socratic' },
  { id: 'char-24', src: '/avatars/char-24.png', label: 'Boardroom' },
  { id: 'char-25', src: '/avatars/char-25.png', label: 'Prosecutor' },
  { id: 'char-26', src: '/avatars/char-26.png', label: 'Defense' },
];

export function isPixelAvatar(value: string | null | undefined): boolean {
  return !!value && value.startsWith('/avatars/char-');
}

export function getAvatarById(id: string): AvatarOption | undefined {
  return AVATAR_GALLERY.find(a => a.id === id);
}

export function getAvatarBySrc(src: string): AvatarOption | undefined {
  return AVATAR_GALLERY.find(a => a.src === src);
}
