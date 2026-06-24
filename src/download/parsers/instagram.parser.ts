import { Injectable, Logger } from '@nestjs/common';
import { BaseParser } from './base.parser';
import { MediaInfoDto } from '../dto/download.dto';
import * as cheerio from 'cheerio';

@Injectable()
export class InstagramParser extends BaseParser {
  private readonly logger = new Logger(InstagramParser.name);
  private readonly instagramMobileUA = 'Instagram 155.0.0.37.107';

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
      const result = this.extractFromHtml(html, cleanUrl);
      if (result.success) return result;

      const rapidApiResult = await this.tryRapidApiFallback(cleanUrl);
      if (rapidApiResult) return rapidApiResult;

      const mobileOEmbed = await this.fetchInstagramMobileOEmbed(cleanUrl);
      if (mobileOEmbed && mobileOEmbed.media_id) {
        const mediaId = mobileOEmbed.media_id as string;
        const sessionId = process.env.INSTAGRAM_SESSIONID;
        if (sessionId) {
          const mobileMediaInfo = await this.fetchInstagramMobileMediaInfo(mediaId, sessionId);
          const urls = this.extractUrlsFromInstagramMediaInfo(mobileMediaInfo);
          if (urls.length) {
            return {
              success: true,
              metadata: {
                platform: 'instagram',
                title: mobileOEmbed.title || '',
                description: mobileOEmbed.title || '',
                thumbnail: mobileOEmbed.thumbnail_url || '',
              },
              urls,
            };
          }
        }
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Instagram parse error: ${message}`);
      return this.buildError('Instagram media could not be extracted. The post may be private or unavailable.');
    }
  }

  private async tryRapidApiFallback(url: string): Promise<MediaInfoDto | null> {
    const rapidApiHost = process.env.RAPIDAPI_HOST ?? 'instagram120.p.rapidapi.com';
    const rapidApiKey = process.env.RAPIDAPI_KEY;
    if (!rapidApiKey) return null;

    if (rapidApiHost === 'instagram120.p.rapidapi.com') {
      const username = this.extractInstagramUsername(url);
      if (username) {
        const reelsResult = await this.tryInstagram120ReelsApi(username, rapidApiHost, rapidApiKey);
        if (reelsResult) return reelsResult;
      }
    }

    const endpoints = [
      `https://${rapidApiHost}/media/info`,
      `https://${rapidApiHost}/post/info`,
      `https://${rapidApiHost}/media`,
      `https://${rapidApiHost}/?url=${encodeURIComponent(url)}`,
      `https://${rapidApiHost}/?link=${encodeURIComponent(url)}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await this.http.get(endpoint, {
          headers: {
            'X-RapidAPI-Host': rapidApiHost,
            'X-RapidAPI-Key': rapidApiKey,
            Accept: 'application/json',
          },
          params: { url },
        });

        const body = response.data as any;
        const urls: MediaInfoDto['urls'] = [];
        if (!body) continue;

        this.tryPushRapidApiUrl(urls, body.media_url, 'video', 'hd', 'mp4');
        this.tryPushRapidApiUrl(urls, body.video_url, 'video', 'hd', 'mp4');
        this.tryPushRapidApiUrl(urls, body.video?.url, 'video', 'hd', 'mp4');
        this.tryPushRapidApiUrl(urls, body.url, 'video', 'hd', 'mp4');
        this.tryPushRapidApiUrl(urls, body.play_url, 'video', 'hd', 'mp4');

        if (Array.isArray(body.images)) {
          for (const img of body.images) {
            if (typeof img === 'string') {
              urls.push({ url: img, type: 'image', quality: 'original', extension: 'jpg' });
            } else if (img?.url) {
              urls.push({ url: img.url, type: 'image', quality: 'original', extension: 'jpg' });
            }
          }
        }

        if (Array.isArray(body.results)) {
          for (const item of body.results) {
            this.tryPushRapidApiUrl(urls, item?.media_url, 'video', 'hd', 'mp4');
            this.tryPushRapidApiUrl(urls, item?.video_url, 'video', 'hd', 'mp4');
          }
        }

        if (urls.length) {
          return {
            success: true,
            metadata: {
              platform: 'instagram',
              title: body.title || body.caption || body.description || '',
              description: body.caption || body.description || '',
              thumbnail: body.thumbnail || body.thumbnail_url || '',
            },
            urls,
          };
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.debug(`RapidAPI Instagram fallback endpoint failed: ${endpoint} (${message})`);
      }
    }

    return null;
  }

  private extractInstagramUsername(url: string): string | null {
    try {
      const pathname = new URL(url).pathname.split('/').filter(Boolean);
      if (!pathname.length) return null;
      const firstSegment = pathname[0].toLowerCase();
      const reservedSegments = ['p', 'reel', 'tv', 'stories', 'explore', 'accounts', 'oauth', 'about', 'directory', 'tags'];
      return reservedSegments.includes(firstSegment) ? null : firstSegment;
    } catch {
      return null;
    }
  }

  private async tryInstagram120ReelsApi(username: string, rapidApiHost: string, rapidApiKey: string): Promise<MediaInfoDto | null> {
    try {
      const response = await this.http.post(
        `https://${rapidApiHost}/api/instagram/reels`,
        { username, maxId: '' },
        {
          headers: {
            'X-RapidAPI-Host': rapidApiHost,
            'X-RapidAPI-Key': rapidApiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
      );

      const data = response.data as any;
      if (!data) return null;

      const urls: MediaInfoDto['urls'] = [];
      const items = Array.isArray(data.results)
        ? data.results
        : Array.isArray(data.data)
        ? data.data
        : [data];

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        this.tryPushRapidApiUrl(urls, item.media_url, 'video', 'hd', 'mp4');
        this.tryPushRapidApiUrl(urls, item.video_url, 'video', 'hd', 'mp4');
        this.tryPushRapidApiUrl(urls, item.url, 'video', 'hd', 'mp4');
        this.tryPushRapidApiUrl(urls, item.play_url, 'video', 'hd', 'mp4');
        this.tryPushRapidApiUrl(urls, item.video?.url, 'video', 'hd', 'mp4');

        if (Array.isArray(item.images)) {
          for (const img of item.images) {
            if (typeof img === 'string') {
              urls.push({ url: img, type: 'image', quality: 'original', extension: 'jpg' });
            } else if (img?.url) {
              urls.push({ url: img.url, type: 'image', quality: 'original', extension: 'jpg' });
            }
          }
        }
      }

      if (urls.length) {
        return {
          success: true,
          metadata: {
            platform: 'instagram',
            title: data.title || data.caption || data.description || '',
            description: data.caption || data.description || '',
            thumbnail: data.thumbnail || data.thumbnail_url || '',
          },
          urls,
        };
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.debug(`Instagram120 RapidAPI reels request failed: ${message}`);
    }

    return null;
  }

  private tryPushRapidApiUrl(urls: MediaInfoDto['urls'], url: any, type: 'video' | 'image', quality: string, extension: string) {
    if (typeof url === 'string' && url.trim()) {
      urls.push({ url: url.trim(), type, quality, extension });
    }
  }

  private async fetchInstagramMobileOEmbed(url: string): Promise<any | null> {
    try {
      const response = await this.http.get(`https://i.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`, {
        headers: {
          'User-Agent': this.instagramMobileUA,
          Accept: 'application/json',
        },
      });
      return response.data;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.debug(`Instagram mobile oEmbed fallback failed: ${message}`);
      return null;
    }
  }

  private async fetchInstagramMobileMediaInfo(mediaId: string, sessionId: string): Promise<any | null> {
    try {
      const response = await this.http.get(`https://i.instagram.com/api/v1/media/${encodeURIComponent(mediaId)}/info/`, {
        headers: {
          'User-Agent': this.instagramMobileUA,
          Accept: 'application/json',
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest',
          Cookie: `sessionid=${sessionId}`,
        },
      });
      return response.data;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.debug(`Instagram mobile media info fallback failed: ${message}`);
      return null;
    }
  }

  private extractUrlsFromInstagramMediaInfo(data: any): MediaInfoDto['urls'] {
    const urls: MediaInfoDto['urls'] = [];
    const items = Array.isArray(data?.items) ? data.items : [];

    for (const item of items) {
      this.extractUrlsFromInstagramMediaItem(item, urls);
    }

    return urls;
  }

  private extractUrlsFromInstagramMediaItem(item: any, urls: MediaInfoDto['urls']): void {
    if (!item || typeof item !== 'object') return;

    if (item.media_type === 8 && Array.isArray(item.carousel_media)) {
      for (const child of item.carousel_media) {
        this.extractUrlsFromInstagramMediaItem(child, urls);
      }
      return;
    }

    if (Array.isArray(item.video_versions)) {
      const sortedVideos = item.video_versions
        .filter((v: any) => typeof v?.url === 'string')
        .sort((a: any, b: any) => (b?.width || 0) - (a?.width || 0));
      for (const video of sortedVideos) {
        urls.push({ url: video.url, type: 'video', quality: 'hd', extension: 'mp4' });
      }
    }

    if (Array.isArray(item.image_versions2?.candidates)) {
      const sortedImages = item.image_versions2.candidates
        .filter((c: any) => typeof c?.url === 'string')
        .sort((a: any, b: any) => (b?.width || 0) - (a?.width || 0));
      if (sortedImages.length && urls.length === 0) {
        urls.push({ url: sortedImages[0].url, type: 'image', quality: 'original', extension: 'jpg' });
      }
    }
  }

  private normalizeUrl(url: string): string {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  }

  private extractFromHtml(html: string, url: string): MediaInfoDto {
    const $ = cheerio.load(html);

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
      const jsonLd = $('script[type="application/ld+json"]').first().html();
      if (jsonLd) {
        try {
          const data = JSON.parse(jsonLd);
          if (data?.contentUrl) {
            urls.push({ url: data.contentUrl, type: 'video', quality: 'hd', extension: 'mp4' });
          }
        } catch (e) {
          this.logger.debug('Instagram JSON-LD parse failed');
        }
      }

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
