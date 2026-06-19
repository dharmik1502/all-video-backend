import { IsUrl, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DownloadRequestDto {
  @IsNotEmpty()
  @IsUrl({
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  url: string;

  @IsOptional()
  @IsString()
  quality?: 'hd' | 'sd';
}

export class MediaInfoDto {
  success: boolean;
  platform: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  author?: string;
  duration?: number;
  medias: MediaItemDto[];
}

export class MediaItemDto {
  url: string;
  quality?: string;
  type: 'video' | 'image' | 'audio';
  extension?: string;
  size?: number;
}
