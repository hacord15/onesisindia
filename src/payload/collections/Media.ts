import path from 'path'
import type { CollectionConfig } from 'payload'
import { anyone, authenticated } from '../access'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    useAsTitle: 'alt',
  },
  access: {
    read: anyone,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      label: 'Alt Text',
      admin: {
        description: 'Describe the image for accessibility & SEO. Required.',
      },
    },
    {
      name: 'caption',
      type: 'text',
      required: false,
    },
  ],
  upload: {
    // Files are stored on the local filesystem. In production set MEDIA_DIR to an
    // absolute, persistent directory OUTSIDE the release/build folder (e.g.
    // /var/lib/onesis/media) so deployments never wipe uploads. Public URLs stay
    // `/api/media/file/<filename>`, served by Payload's built-in file route.
    staticDir: process.env.MEDIA_DIR
      ? path.resolve(process.env.MEDIA_DIR)
      : path.resolve(process.cwd(), 'media'),
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 300, position: 'centre' },
      { name: 'card', width: 800, height: 600, position: 'centre' },
      { name: 'banner', width: 1920, height: 800, position: 'centre' },
    ],
    adminThumbnail: 'thumbnail',
     mimeTypes: ['image/*', 'application/pdf'],
  },
}
