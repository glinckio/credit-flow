import { ApiProperty } from '@nestjs/swagger';
import {
  type Permission,
  Permission as PermissionValues,
  Role,
  effectivePermissions,
} from '@creditflow/shared';

/** The authenticated user as seen by controllers, services and the web app. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  canDecide: boolean;
  mustChangePassword: boolean;
  permissions: Permission[];
}

export function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  role: Role;
  canDecide: boolean;
  mustChangePassword: boolean;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    canDecide: user.canDecide,
    mustChangePassword: user.mustChangePassword,
    permissions: effectivePermissions(user),
  };
}

/** Swagger schema for AuthUser. */
export class AuthUserDto implements AuthUser {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: Object.values(Role) }) role!: Role;
  @ApiProperty() canDecide!: boolean;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty({ enum: Object.values(PermissionValues), isArray: true })
  permissions!: Permission[];
}

export class AuthUserResponseDto {
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}
