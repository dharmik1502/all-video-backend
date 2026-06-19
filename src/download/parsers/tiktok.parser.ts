import { Injectable, Logger } from '@nestjs/common';
import { BaseParser } from './base.parser';
import { MediaInfoDto } from '../dto/download.dto';
import * as cheerio from 'cheerio';

@Injectable()
export class TiktokParser extends BaseParser {
  private readonly logger = new Logger(TiktokParser.name);

  async parse(url: string): Promise<MediaInfoDto> {
    try {
      // Resolve short URLs (vm.tiktok.com, vt.tiktok.com)
      const resolvedUrl = await this.resolveRedirects(url);

      const response = await this.http.get(resolvedUrl, {
        headers: {
          ...this.http.defaults.headers.common,
          Referer: 'https://www.tiktok.com/',
          Cookie: 'tt_webid_v2=1; tt_chain_token=1;',
        },
      });

      return this.extractFromHtml(response.data, resolvedUrl);
    } catch (error) {
      this.logger.error(`TikTok parse error: ${error.message}`);
      return this.buildError('TikTok video could not be extracted.');
    }
  }

  private async resolveRedirects(url: string): Promise<string> {
    try {
      const response = await this.http.get(url, { maxRedirects: 5 });
      return response.request?.res?.responseUrl ?? url;
    } catch {
      return url;
    }
  }

  private extractFromHtml(html: string, url: string): MediaInfoDto {
    const $ = cheerio.load(html);

    const ogTitle = $('meta[property="og:title"]').attr('content') ?? 'TikTok Video';
    const ogDescription = $('meta[property="og:description"]').attr('content') ?? '';
    const ogImage = $('meta[property="og:image"]').attr('content') ?? '';
    const ogVideo = $('meta[property="og:video"]').attr('content') ?? '';
    const ogVideoSecure = $('meta[property="og:video:secure_url"]').attr('content') ?? '';

    const medias: MediaInfoDto['medias'] = [];

    const videoUrl = ogVideoSecure || ogVideo;
    if (videoUrl) {
      medias.push({ url: videoUrl, type: 'video', quality: 'hd', extension: 'mp4' });
    }

    // Try to find video data in JSON-LD
    const jsonLdScript = $('script[type="application/ld+json"]').first().html();
    if (jsonLdScript) {
      try {
        const jsonData = JSON.parse(jsonLdScript);
        if (jsonData.contentUrl && !videoUrl) {
          medias.push({
            url: jsonData.contentUrl,
            type: 'video',
            quality: 'hd',
            extension: 'mp4',
          });
        }
      } catch { /* ignore */ }
    }

    if (medias.length === 0) {
      return this.buildError('TikTok video not accessible. May be private or deleted.');
    }

    // Extract author from URL @username
    const authorMatch = url.match(/@([\w.]+)\//);

    return {
      success: true,
      platform: 'tiktok',
      title: ogTitle,
      description: ogDescription,
      thumbnail: ogImage,
      author: authorMatch ? `@${authorMatch[1]}` : undefined,
      medias,
    };
  }
}
