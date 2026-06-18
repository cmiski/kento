export type AuthUser = {
  id: string;
  email: string;
  roles: string[];
};

export type AuthTokenPayload = AuthUser & {
  type: "access";
};
