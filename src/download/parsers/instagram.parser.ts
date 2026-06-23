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
      // Try JSON-LD first
      const jsonLd = $('script[type="application/ld+json"]').first().html();
      if (jsonLd) {
        try {
          const data = JSON.parse(jsonLd);
          if (data && data.contentUrl) {
            urls.push({ url: data.contentUrl, type: 'video', quality: 'hd', extension: 'mp4' });
          }
        } catch (e) {
          this.logger.debug('Instagram JSON-LD parse failed');
        }
      }

      // Try window._sharedData embedded script (older Instagram pages)
      if (urls.length === 0) {
        const scripts = $('script')
          .map((i, el) => $(el).html())
          .get()
          .filter(Boolean);

        for (const s of scripts) {
          if (s.includes('window._sharedData')) {
            try {
              const m = s.match(/window\._sharedData\s*=\s*(\{.*\});/s);
              if (m && m[1]) {
                const shared = JSON.parse(m[1]);
                const media =
                  shared?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media ||
                  shared?.entry_data?.VideoPage?.[0]?.graphql?.shortcode_media;
                if (media) {
                  if (media.video_url) {
                    urls.push({ url: media.video_url, type: 'video', quality: 'hd', extension: 'mp4' });
                  } else if (media.display_url) {
                    urls.push({ url: media.display_url, type: 'image', quality: 'original', extension: 'jpg' });
                  } else if (media.edge_sidecar_to_children?.edges) {
                    for (const edge of media.edge_sidecar_to_children.edges) {
                      const node = edge.node;
                      if (node.video_url) {
                        urls.push({ url: node.video_url, type: 'video', quality: 'hd', extension: 'mp4' });
                      } else if (node.display_url) {
                        urls.push({ url: node.display_url, type: 'image', quality: 'original', extension: 'jpg' });
                      }
                    }
                  }
                }
              }
            } catch (e) {
              this.logger.debug('Instagram sharedData parse failed');
            }
            break;
          }
        }
      }

      if (urls.length === 0) {
        try {
          this.logger.debug('Instagram extract failed — page snippet: ' + html.slice(0, 2000));
        } catch {}
        return this.buildError('Could not extract media. Post may be private.', 'instagram');
      }
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
