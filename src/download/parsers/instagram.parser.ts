import { Injectable, Logger } from '@nestjs/common';
import { BaseParser } from './base.parser';
import { MediaInfoDto } from '../dto/download.dto';
import * as cheerio from 'cheerio';

@Injectable()
export class InstagramParser extends BaseParser {
  private readonly logger = new Logger(InstagramParser.name);

  async parse(url: string): Promise<MediaInfoDto> {
    try {
      const cleanUrl = this.normalizeUrl(url);
      const response = await this.http.get(cleanUrl, {
        headers: {
          ...this.http.defaults.headers.common,
          Referer: 'https://www.instagram.com/',
          'X-IG-App-ID': '936619743392459',
        },
      });

      const html = response.data as string;
      return this.extractFromHtml(html, cleanUrl);
    } catch (error) {
      this.logger.error(`Instagram parse error: ${error.message}`);
      return this.buildError('Instagram media could not be extracted. The post may be private or unavailable.');
    }
  }

  private normalizeUrl(url: string): string {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  }

  private extractFromHtml(html: string, url: string): MediaInfoDto {
    const $ = cheerio.load(html);

    // Extract OG meta tags (public posts always have these)
    const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
    const ogDescription = $('meta[property="og:description"]').attr('content') ?? '';
    const ogImage = $('meta[property="og:image"]').attr('content') ?? '';
    const ogVideo = $('meta[property="og:video"]').attr('content') ?? '';
    const ogVideoSecure = $('meta[property="og:video:secure_url"]').attr('content') ?? '';

    const urls: MediaInfoDto['urls'] = [];

    const videoUrl = ogVideoSecure || ogVideo;
    if (videoUrl) {
      urls.push({ url: videoUrl, type: 'video', quality: 'hd', extension: 'mp4' });
    }

    if (ogImage && !videoUrl) {
      urls.push({ url: ogImage, type: 'image', quality: 'original', extension: 'jpg' });
    }

    if (urls.length === 0) {
      return this.buildError('Could not extract media. Post may be private.', 'instagram');
    }

    return {
      success: true,
      metadata: {
        platform: 'instagram',
        title: ogTitle.replace(' • Instagram', '').trim(),
        description: ogDescription,
        thumbnail: ogImage,
      },
      urls,
    };
  }
}
